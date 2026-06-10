// lib/realBackend.js
// REAL video deepfake detection — the one capability with a live model behind it.
//
// The model is "VideoVeritas" (a Qwen3-VL real-vs-AI video classifier) served on a
// Kaggle T4 box via vLLM's OpenAI-compatible API and exposed to the internet with
// ngrok (see videoveritas-ai-video-detection.ipynb). This module is the client.
//
// Design: this is the FIRST real swap-in described in the README ("replace the
// Mock.* calls with fetch()"). It ONLY handles the video modality; image stays on
// the free local/mock path. The service worker calls detectVideo() before the mock
// when (a) the post has video, (b) the user is premium, and (c) a backend URL is set.
// Any failure returns { error } so the worker can fall back to the mock.
//
// Service-worker-only (loaded via importScripts). btoa/fetch exist in workers.
(function (g) {
  const URL_KEY = (g.VerilensConfig && g.VerilensConfig.STORAGE_KEYS.BACKEND_URL)
    || "verilens_backend_url";

  // ngrok's free tier injects a browser interstitial unless this header is sent.
  function headers() {
    return { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" };
  }

  function normalize(u) {
    return String(u || "").trim().replace(/\/+$/, ""); // strip trailing slashes
  }

  async function getBackendUrl() {
    const o = await chrome.storage.local.get(URL_KEY);
    return normalize(o[URL_KEY]);
  }

  // GET /v1/models — used by the popup "Test connection" button and to discover the
  // exact served model id (vLLM validates the `model` field against it).
  async function ping(url) {
    const base = normalize(url);
    if (!base) return { ok: false, error: "No backend URL set." };
    try {
      const r = await fetch(base + "/v1/models", { headers: headers() });
      if (!r.ok) return { ok: false, error: "HTTP " + r.status };
      const j = await r.json();
      const id = j && j.data && j.data[0] && j.data[0].id;
      return { ok: true, model: id || "(model loaded)" };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  // Cache the discovered model id per base URL (cheap; avoids a round-trip per scan).
  let _modelId = null;
  let _modelBase = null;
  async function getModelId(base) {
    if (_modelId && _modelBase === base) return _modelId;
    const res = await ping(base);
    if (res.ok) {
      _modelId = res.model;
      _modelBase = base;
    }
    return _modelId;
  }

  // ---- video bytes → data URL ----------------------------------------------
  const MAX_BYTES = 12 * 1024 * 1024; // 12 MB cap — keeps inference fast on a T4

  function base64FromBytes(bytes) {
    let bin = "";
    const CHUNK = 0x8000; // avoid String.fromCharCode arg-count limits
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function extOf(url) {
    const m = String(url).split("?")[0].match(/\.(mp4|webm|mov|m4v|mkv)$/i);
    return m ? m[1].toLowerCase() : "mp4";
  }

  // Produce a `data:video/...;base64,...` URL (what the model ingests). Prefers bytes
  // the content script already captured (blob: videos); otherwise fetches a direct
  // https video URL here in the worker (host-permission CORS bypass).
  async function toDataUrl(payload) {
    if (payload.videoDataUrl) return payload.videoDataUrl;
    const u = payload.videoUrl;
    if (!u || !/^https?:/i.test(u)) return null; // blob:/HLS we can't reach → null
    const resp = await fetch(u, { headers: { "ngrok-skip-browser-warning": "true" } });
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length > MAX_BYTES) return null;
    return "data:video/" + extOf(u) + ";base64," + base64FromBytes(bytes);
  }

  // ---- verdict parsing ------------------------------------------------------
  const SYSTEM =
    "You are an expert video forensics analyst. Decide whether a video is a genuine " +
    "camera recording or AI-generated / deepfake. First give a one-sentence reason, " +
    "then end with your final verdict as exactly <answer>real</answer> or " +
    "<answer>fake</answer>.";

  function parseVerdict(content) {
    const text = content || "";
    const m = /<answer>([\s\S]*?)<\/answer>/i.exec(text);
    const ans = (m ? m[1] : text).trim().toLowerCase();

    // Reason = everything before the answer tag (or the whole reply if no tag).
    let reason = (m ? text.slice(0, m.index) : text.replace(/<answer>[\s\S]*?<\/answer>/i, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (reason.length > 320) reason = reason.slice(0, 317) + "…";

    let band, verdict, prob;
    if (/\b(fake|ai|deepfake|synthet|generated|artificial)\b/.test(ans)) {
      band = "red";
      verdict = "likely_ai";
      prob = 0.9;
    } else if (/\b(real|authentic|genuine)\b/.test(ans)) {
      band = "green";
      verdict = "likely_real";
      prob = 0.08;
    } else {
      band = "amber";
      verdict = "uncertain";
      prob = 0.5;
    }
    return { band, verdict, prob, reason, raw: ans };
  }

  // Returns a parsed verdict { band, verdict, prob, reason } or { error }.
  async function detectVideo(payload) {
    const base = await getBackendUrl();
    if (!base) return { error: "no_backend" };

    const model = (await getModelId(base)) || "VideoVeritas";

    // Two ways the pixels reach us:
    //  A) videoFrames[] — real frames the content script grabbed off an MSE
    //     <video> via canvas (Instagram/Twitter/Facebook). Sent as images.
    //  B) a fetchable video (blob: bytes or an https URL the worker fetches),
    //     sent as a single video_url. Used for direct .mp4 and the like.
    let userContent;
    const mmKwargs = {};
    const hasFrames = Array.isArray(payload.videoFrames) && payload.videoFrames.length > 0;

    if (hasFrames) {
      userContent = payload.videoFrames.map((f) => ({ type: "image_url", image_url: { url: f } }));
      userContent.push({
        type: "text",
        text:
          "The images above are " +
          payload.videoFrames.length +
          " frames sampled in order from a single short video clip. Judge the video as a " +
          "whole: is it a genuine camera recording or AI-generated / deepfake?",
      });
      // Keep per-image token cost bounded (frames are already downscaled).
      mmKwargs.max_pixels = 360 * 420;
    } else {
      let dataUrl;
      try {
        dataUrl = await toDataUrl(payload);
      } catch (e) {
        return { error: "fetch_video: " + String((e && e.message) || e) };
      }
      if (!dataUrl) return { error: "no_video_bytes" };

      userContent = [
        { type: "video_url", video_url: { url: dataUrl } },
        { type: "text", text: "Is this video real or AI-generated/fake?" },
      ];

      // Mirrors the Kaggle notebook's frame sampling (kept small for T4 budget).
      const FPS = 2;
      mmKwargs.fps = FPS;
      mmKwargs.max_pixels = 360 * 420;
      // "How much of the video can the model see" → frame-count cap. 0 = full.
      if (typeof payload.videoMaxSeconds === "number" && payload.videoMaxSeconds > 0) {
        mmKwargs.max_frames = Math.max(1, Math.round(payload.videoMaxSeconds * FPS));
      }
    }

    const body = {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 512,
      mm_processor_kwargs: mmKwargs,
    };

    try {
      const r = await fetch(base + "/v1/chat/completions", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { error: "HTTP " + r.status + (t ? " — " + t.slice(0, 200) : "") };
      }
      const j = await r.json();
      const content =
        (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      if (!content) return { error: "empty_response" };
      return parseVerdict(content);
    } catch (e) {
      return { error: "network: " + String((e && e.message) || e) };
    }
  }

  g.VerilensRealBackend = { getBackendUrl, ping, detectVideo };
})(globalThis);
