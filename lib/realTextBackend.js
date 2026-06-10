// lib/realTextBackend.js
// Client for the Fast-DetectGPT AI-text detection model served on Kaggle T4 via
// a FastAPI server exposed to the internet with ngrok (see fast-gpt.ipynb).
//
// API contract (mirrors what the notebook exposes):
//   POST /detect-text
//   Body: { "text": "..." }
//   Response: { "ai_probability": 0.0–1.0, "criterion": float, "tokens": int }
//
// This module is loaded by the service worker only (importScripts). On failure
// it returns { error } so the worker can fall back to the mock transparently.
(function (g) {
  // Read the storage key from the central config if it's already loaded,
  // otherwise fall back to the hardcoded string (safe either way).
  const URL_KEY = (g.VerilensConfig && g.VerilensConfig.STORAGE_KEYS.TEXT_BACKEND_URL)
    || "verilens_text_backend_url";

  // ngrok free tier needs this header to skip the browser interstitial.
  function headers() {
    return { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" };
  }

  function normalize(u) {
    return String(u || "").trim().replace(/\/+$/, "");
  }

  async function getBackendUrl() {
    const o = await chrome.storage.local.get(URL_KEY);
    return normalize(o[URL_KEY]);
  }

  // GET /health — used by the popup "Test connection" button.
  async function ping(url) {
    const base = normalize(url);
    if (!base) return { ok: false, error: "No text backend URL set." };
    try {
      const r = await fetch(base + "/health", { headers: headers() });
      if (!r.ok) return { ok: false, error: "HTTP " + r.status };
      const j = await r.json();
      return { ok: true, model: (j && j.model) || "Fast-DetectGPT" };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  // Classify text as AI-generated or human-written.
  // Returns { band, verdict, prob, criterion, tokens } or { error }.
  async function detectText(payload) {
    const base = await getBackendUrl();
    if (!base) return { error: "no_text_backend" };

    const text = (payload && payload.text) || "";
    if (!text.trim()) return { error: "empty_text" };

    try {
      const r = await fetch(base + "/detect-text", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { error: "HTTP " + r.status + (t ? " — " + t.slice(0, 200) : "") };
      }
      const j = await r.json();
      if (j && j.error) return { error: j.error };

      const prob = typeof j.ai_probability === "number" ? j.ai_probability : null;
      if (prob === null) return { error: "invalid_response" };

      // Map probability to the same band/verdict shape used by the mock.
      let band, verdict;
      if (prob < 0.4) {
        band = "green";
        verdict = "likely_human";
      } else if (prob < 0.7) {
        band = "amber";
        verdict = "mixed";
      } else {
        band = "red";
        verdict = "likely_ai";
      }

      const textExplain = {
        green: "The text lacks typical AI patterns. Statistical signals point to human authorship.",
        amber: "Some phrasing is ambiguous — could be AI-assisted or human-written. Inconclusive.",
        red: "Strong statistical markers of AI generation detected (high predictability and uniform perplexity).",
      };

      return {
        aiGenerated: Math.round(prob * 100) / 100,
        band,
        verdict,
        explanation: textExplain[band],
        criterion: j.criterion,
        tokens: j.tokens,
        source: "fast-detect-gpt",
      };
    } catch (e) {
      return { error: "network: " + String((e && e.message) || e) };
    }
  }

  g.VerilensRealTextBackend = { getBackendUrl, ping, detectText };
})(globalThis);
