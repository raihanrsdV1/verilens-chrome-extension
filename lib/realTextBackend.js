// lib/realTextBackend.js
// Client for the Fast-DetectGPT AI-text detection model served on Kaggle T4 via
// a FastAPI server exposed to the internet with ngrok (see notebooks/fast-gpt.ipynb).
//
// API contract (mirrors what the notebook exposes):
//   POST /detect-text
//   Body: { "text": "..." }
//   Response: { "ai_probability": 0.0–1.0, "criterion": float, "tokens": int }
//
// This module is loaded by the service worker only (importScripts). On failure
// it returns { error } so the worker can fall back to the mock transparently.
(function (g) {
  // ngrok free tier needs this header to skip the browser interstitial.
  function headers() {
    return { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" };
  }

  function normalize(u) {
    return String(u || "").trim().replace(/\/+$/, "");
  }

  // Backend URL comes from lib/config.local.js (gitignored, loaded before this
  // file via importScripts) — never from chrome.storage / the popup UI.
  async function getBackendUrl() {
    return normalize((g.VerilensConfig || {}).textBackendUrl);
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
      let band, verdict, label;
      if (prob < 0.3) {
        band = "green";
        verdict = "human_safe";
        label = "Human safe";
      } else if (prob < 0.4) {
        band = "amber";
        verdict = "minor_ai_traces";
        label = "Minor AI traces";
      } else if (prob < 0.5) {
        band = "amber";
        verdict = "mixed";
        label = "Mixed signals";
      } else {
        band = "red";
        verdict = "likely_ai";
        label = "This is AI";
      }

      const textExplain = {
        human_safe: "The text lacks typical AI patterns. Statistical signals point to human authorship.",
        minor_ai_traces: "Some subtle patterns detected that occasionally appear in AI writing.",
        mixed: "Some phrasing is ambiguous — could be AI-assisted or human-written. Inconclusive.",
        likely_ai: "Strong statistical markers of AI generation detected (high predictability and uniform perplexity).",
      };

      return {
        aiGenerated: Math.round(prob * 100) / 100,
        band,
        verdict,
        label,
        explanation: textExplain[verdict],
        criterion: j.criterion,
        tokens: j.tokens,
        source: "fast-detect-gpt",
      };
    } catch (e) {
      return { error: "network: " + String((e && e.message) || e) };
    }
  }

  g.VerilensRealTextBackend = { getBackendUrl, detectText };
})(globalThis);
