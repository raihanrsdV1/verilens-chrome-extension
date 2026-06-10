// service-worker.js
// The extension's "brain". MV3 runs this as a service worker that TERMINATES
// when idle, so we keep ZERO important state in globals — everything durable
// lives in chrome.storage.local (tier + cache mirror).
//
// Responsibilities (M1):
//   - route messages from content scripts
//   - enforce tier rules
//   - check the local cache mirror, call the mock backend on a miss
//   - persist verdicts to the mirror
//
// We use importScripts (classic worker, NOT an ES module) so the lib/* files
// can be shared verbatim with the content scripts. Paths are relative to the
// extension root.
importScripts(
  "lib/tiers.js",
  "lib/hash.js",
  "lib/cache.js",
  "lib/provenanceLocalMock.js",
  "lib/provenanceLocal.js",
  "lib/mockBackend.js",
  "lib/realBackend.js"
);

const Cache = self.VerilensCache;
const Mock = self.VerilensMock;
const Tiers = self.VerilensTiers;
const Provenance = self.VerilensProvenance;
const RealBackend = self.VerilensRealBackend;

const TIER_KEY = "verilens_tier";

// Flip to false to silence dev logs. When true, the worker prints what it
// RECEIVED and what it RETURNED to the SERVICE WORKER console (chrome://extensions
// → Verilens → "service worker"), so you can confirm the request crossed the
// boundary and see whether it was a cache hit, a tier gate, or a fresh result.
const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log("%c[Verilens SW]", "color:#2ecc71;font-weight:bold", ...args);
}

async function getTier() {
  const o = await chrome.storage.local.get(TIER_KEY);
  return o[TIER_KEY] || "free"; // default everyone to free
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Session stats shown in the popup. Small object, incremented on real work only
// (never on cache hits, to avoid inflating counts on re-scans).
async function bumpStat(key, n = 1) {
  const o = await chrome.storage.local.get("verilens_stats");
  const s = o.verilens_stats || {};
  s[key] = (s[key] || 0) + n;
  await chrome.storage.local.set({ verilens_stats: s });
}

// ---- Deepfake scan ---------------------------------------------------------
async function handleDeepfake(payload) {
  log("deepfake ← received payload:", payload);
  const tier = await getTier();

  // Tier gate: a post with NO image and only video/audio needs the premium
  // multimodal models. Free users get an upgrade prompt and we never run it.
  const hasImage = (payload.imageUrls || []).length > 0;
  if (!hasImage && payload.hasVideo && !Tiers.isAllowed("deepfakeVideo", tier)) {
    log("deepfake = GATED (video, tier:", tier + ") — backend NOT called");
    return {
      gated: true,
      feature: "deepfakeVideo",
      message:
        "Video & audio deepfake analysis uses premium multimodal models. Upgrade to Premium to check this.",
    };
  }

  // 1) Local mirror first → instant badge for already-scanned posts.
  const cachedVerdict = await Cache.getVerdict(payload.postId, "deepfake");
  if (cachedVerdict) {
    log("deepfake = CACHE HIT for postId", payload.postId);
    return { ...cachedVerdict, cached: true };
  }

  // 2) STAGE A — LOCAL provenance pre-check (C2PA). No model, no backend. A
  //    signed credential declaring AI is authoritative → confirm instantly and
  //    skip the pipeline entirely. ABSENCE proves nothing → fall through.
  const prov = await Provenance.check(payload);
  if (prov.state === "present" && prov.standard === "c2pa") {
    log("deepfake = STAGE A HIT (C2PA present) — backend SKIPPED, source:", prov.source);
    const confirmedResult = buildC2PAConfirmed(payload, prov);
    confirmedResult.cached = false;
    await Cache.setVerdict(payload.postId, confirmedResult, "deepfake");
    await bumpStat("deepfakeScans");
    await bumpStat("confirmedAI");
    return confirmedResult;
  }

  // 2.5) REAL video deepfake via the hosted VideoVeritas model. Only fires when the
  //      post has video, the user is premium-entitled, and a backend URL is set.
  //      Any failure (no bytes, unreachable, bad response) falls through to the mock
  //      so demos keep working. Image-only posts never hit this path.
  if (payload.hasVideo && Tiers.isAllowed("deepfakeVideo", tier)) {
    const backendUrl = await RealBackend.getBackendUrl();
    if (backendUrl) {
      log("deepfake = calling REAL VideoVeritas backend:", backendUrl);
      const v = await RealBackend.detectVideo(payload);
      if (v && !v.error) {
        const result = buildVideoResult(payload, v);
        result.cached = false;
        await Cache.setVerdict(payload.postId, result, "deepfake");
        await bumpStat("deepfakeScans");
        log("deepfake → REAL video result:", result);
        return result;
      }
      log("deepfake = real backend unavailable (" + (v && v.error) + ") — falling back to mock");
    }
  }

  // 2.7) REAL image deepfake via the hosted FSD model. Fires when the post has an
  //      image and an image backend URL is set. Image detection is FREE (no tier
  //      gate). Runs AFTER the video block so image+video posts still prefer the
  //      richer video model. Any failure falls through to the mock.
  if (hasImage) {
    const imageBackendUrl = await RealBackend.getImageBackendUrl();
    if (imageBackendUrl) {
      log("deepfake = calling REAL FSD image backend:", imageBackendUrl);
      const im = await RealBackend.detectImage(payload);
      if (im && !im.error) {
        const result = buildImageResult(payload, im);
        result.cached = false;
        await Cache.setVerdict(payload.postId, result, "deepfake");
        await bumpStat("deepfakeScans");
        log("deepfake → REAL image result:", result);
        return result;
      }
      log("deepfake = FSD image backend unavailable (" + (im && im.error) + ") — falling back to mock");
    }
  }

  // 3) STAGE B — backend (mock). Simulate first-scan latency so the UI gets to
  //    show loading states. (Real backend runs SynthID + the heavy pipeline.)
  log("deepfake = Stage A absent; calling backend (tier:", tier + ")");
  await delay(400 + Math.floor(Math.random() * 500)); // 400–900ms

  const result = Mock.deepfake(payload, tier);
  result.cached = false;

  await Cache.setVerdict(payload.postId, result, "deepfake");
  await bumpStat("deepfakeScans");
  if (result.confirmed) await bumpStat("confirmedAI");
  log("deepfake → returning result:", result);
  return result;
}

// Build a high-confidence "Confirmed AI" verdict from a local C2PA hit. No model
// numbers are invented — the credential itself is the evidence.
function buildC2PAConfirmed(payload, prov) {
  return {
    postId: payload.postId,
    band: "red",
    confirmed: "c2pa",
    provenance: { c2pa: "present", synthid: "not_checked", source: prov.source },
    media: {
      image: { available: true, aiGenerated: 0.99, verdict: "likely_ai" },
      video: payload.hasVideo
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_video" },
      audio: payload.hasAudio
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_audio" },
    },
    explanation:
      "This image carries signed C2PA Content Credentials declaring it was generated or edited with AI. That's a verifiable provenance signal — no model guess needed.",
  };
}

// Shape a real VideoVeritas verdict into the deepfake contract. The model only
// judges the VIDEO modality; image/audio are reported as not-analyzed here.
function buildVideoResult(payload, v) {
  const hasImage = (payload.imageUrls || []).length > 0;
  return {
    postId: payload.postId,
    band: v.band,
    confirmed: null,
    provenance: { c2pa: "absent", synthid: "not_checked", source: null },
    media: {
      image: hasImage
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_image" },
      video: { available: true, aiGenerated: v.prob, verdict: v.verdict },
      audio: payload.hasAudio
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_audio" },
    },
    explanation:
      (v.reason ? v.reason + " " : "") +
      "Verdict from the VideoVeritas video model analyzing sampled frames.",
    source: "videoveritas",
  };
}

// Shape a real FSD verdict into the deepfake contract. FSD judges only the IMAGE
// modality (binary real-vs-AI); video/audio are reported as not-analyzed here.
function buildImageResult(payload, im) {
  return {
    postId: payload.postId,
    band: im.band,
    confirmed: null,
    provenance: { c2pa: "absent", synthid: "not_checked", source: null },
    media: {
      image: { available: true, aiGenerated: im.prob, verdict: im.verdict },
      video: payload.hasVideo
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_video" },
      audio: payload.hasAudio
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_audio" },
    },
    explanation:
      (im.reason ? im.reason + " " : "") +
      "Verdict from the FSD (Forensic Self-Descriptions) image forensics model.",
    source: "fsd",
  };
}

// ---- Fact-check scan -------------------------------------------------------
async function handleFactcheck(payload) {
  log("factcheck ← received payload:", payload);
  const tier = await getTier();

  // Tier gate FIRST. Fact-check runs an expensive agent + search, so for free
  // users we short-circuit with an upgrade prompt and NEVER call the backend.
  if (!Tiers.isAllowed("factCheck", tier)) {
    log("factcheck = GATED (tier:", tier + ") — backend NOT called");
    return {
      gated: true,
      feature: "factCheck",
      message:
        "Fact-check runs an AI agent that verifies claims against trusted sources. Upgrade to Premium to use it.",
    };
  }

  // Separate cache namespace from deepfake.
  const cachedVerdict = await Cache.getVerdict(payload.postId, "factcheck");
  if (cachedVerdict) {
    log("factcheck = CACHE HIT for postId", payload.postId);
    return { ...cachedVerdict, cached: true };
  }

  log("factcheck = cache miss; calling mock backend");
  await delay(500 + Math.floor(Math.random() * 700)); // 500–1200ms (agent is slower)

  const result = Mock.factcheck(payload);
  result.cached = false;

  await Cache.setVerdict(payload.postId, result, "factcheck");
  await bumpStat("factCheckScans");
  log("factcheck → returning result:", result);
  return result;
}

// ---- Classify (auto-filter, cheap batched path) ----------------------------
async function handleClassify(payload) {
  const tier = await getTier();

  // Auto-filter is premium. If the user isn't entitled, return nothing to act
  // on (the content script also gates this, but the worker is authoritative).
  if (!Tiers.isAllowed("autoFilter", tier)) {
    log("classify = GATED (tier:", tier + ") — backend NOT called");
    return { results: [], gated: true, feature: "autoFilter" };
  }

  const posts = (payload && payload.posts) || [];
  const results = [];
  const toClassify = [];

  // One batched read instead of one read per post.
  const cachedMap = await Cache.getManyVerdicts(
    posts.map((p) => p.postId),
    "classify"
  );
  for (const p of posts) {
    if (cachedMap[p.postId]) results.push({ ...cachedMap[p.postId], cached: true });
    else toClassify.push(p);
  }

  if (toClassify.length) {
    // Cheap path → short delay (vs. the heavy pipelines above).
    await delay(150 + Math.floor(Math.random() * 200)); // 150–350ms
    const fresh = Mock.classify({ posts: toClassify }).results;
    const byId = new Map(fresh.map((r) => [r.postId, r]));

    // LOCAL C2PA on the filter path: it's free and instant (no API), so we run
    // it on every post here. A signed credential is a definitive "ai_generated"
    // signal — add the label even if the cheap classifier missed it.
    await Promise.all(
      toClassify.map(async (p) => {
        const r = byId.get(p.postId);
        if (!r) return;
        const prov = await Provenance.check(p);
        if (prov.state === "present" && prov.standard === "c2pa") {
          if (!r.labels.includes("ai_generated")) r.labels.push("ai_generated");
          r.provenance = "c2pa"; // mark the source so the filter can show "Confirmed"
        }
      })
    );

    // One batched write instead of one write per post.
    await Cache.setManyVerdicts(
      fresh.map((r) => ({ postId: r.postId, verdict: r })),
      "classify"
    );
    results.push(...fresh);
    log("classify = " + toClassify.length + " new, " + (posts.length - toClassify.length) + " cached");
  }

  return { results };
}

// ---- AI Text Detection -----------------------------------------------------
async function handleDetectText(payload) {
  log("detectText ← received payload:", payload);
  const tier = await getTier();

  if (!Tiers.isAllowed("detectText", tier)) {
    log("detectText = GATED (tier:", tier + ") — backend NOT called");
    return {
      gated: true,
      feature: "detectText",
      message: "AI text detection is a premium feature. Upgrade to Premium to analyze highlighted text.",
    };
  }

  const cachedVerdict = await Cache.getVerdict(payload.textHash, "detectText");
  if (cachedVerdict) {
    log("detectText = CACHE HIT for textHash", payload.textHash);
    return { ...cachedVerdict, cached: true };
  }

  log("detectText = cache miss; calling mock backend");
  await delay(400 + Math.floor(Math.random() * 500)); // 400–900ms

  const result = Mock.detectText(payload);
  result.cached = false;

  await Cache.setVerdict(payload.textHash, result, "detectText");
  await bumpStat("detectTextScans");
  log("detectText → returning result:", result);
  return result;
}

// ---- Message router --------------------------------------------------------
// Returning `true` keeps the sendResponse channel open for async work.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg && msg.type) {
    case "SCAN_DEEPFAKE":
      handleDeepfake(msg.payload)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: String(e) }));
      return true;

    case "SCAN_FACTCHECK":
      handleFactcheck(msg.payload)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: String(e) }));
      return true;

    case "DETECT_TEXT":
      handleDetectText(msg.payload)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: String(e) }));
      return true;

    case "CLASSIFY":
      handleClassify(msg.payload)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: String(e) }));
      return true;

    case "GET_TIER":
      getTier().then((tier) => sendResponse({ tier }));
      return true;

    // Popup "Test connection" for the VideoVeritas backend (ngrok URL).
    case "PING_BACKEND":
      RealBackend.ping(msg.url)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;

    // Popup "Test connection" for the FSD image backend (ngrok URL).
    case "PING_IMAGE_BACKEND":
      RealBackend.pingImage(msg.url)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;

    // Dev helper so we can flip tiers from the console before the popup exists.
    case "SET_TIER":
      chrome.storage.local
        .set({ [TIER_KEY]: msg.tier === "premium" ? "premium" : "free" })
        .then(() => sendResponse({ ok: true, tier: msg.tier }));
      return true;

    default:
      return false;
  }
});

// Seed sane defaults on install (without clobbering anything already set).
chrome.runtime.onInstalled.addListener(async () => {
  const o = await chrome.storage.local.get([
    TIER_KEY,
    "verilens_autofilter_enabled",
    "verilens_filter_categories",
    "verilens_backend_url",
    "verilens_image_backend_url",
    "verilens_hover_detect_enabled",
    "verilens_video_max_seconds",
  ]);
  const seed = {};
  if (o[TIER_KEY] === undefined) seed[TIER_KEY] = "free";
  if (o.verilens_autofilter_enabled === undefined) seed.verilens_autofilter_enabled = false;
  if (o.verilens_backend_url === undefined) seed.verilens_backend_url = "";
  if (o.verilens_image_backend_url === undefined) seed.verilens_image_backend_url = "";
  if (o.verilens_hover_detect_enabled === undefined) seed.verilens_hover_detect_enabled = true;
  if (o.verilens_video_max_seconds === undefined) seed.verilens_video_max_seconds = 20;
  if (o.verilens_filter_categories === undefined) {
    seed.verilens_filter_categories = {
      political: true,
      ai_meme: true,
      ai_generated: true,
      misinformation: true,
    };
  }
  if (Object.keys(seed).length) await chrome.storage.local.set(seed);
});
