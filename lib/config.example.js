// lib/config.example.js
// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE — copy this file to lib/config.js and fill in your real values.
// lib/config.js is gitignored so secrets never reach the repo.
//
// Usage in the service worker (importScripts loads it before other lib files):
//   importScripts("lib/config.js", ...)
//   const cfg = self.VerilensConfig;
//   cfg.STORAGE_KEYS.BACKEND_URL  // "verilens_backend_url"
// ─────────────────────────────────────────────────────────────────────────────
(function (g) {
  g.VerilensConfig = {

    // ── Storage key names ────────────────────────────────────────────────────
    // Single source of truth. All chrome.storage.local reads/writes must use
    // these constants — never inline the string anywhere else.
    STORAGE_KEYS: {
      TIER:                  "verilens_tier",
      AUTOFILTER_ENABLED:    "verilens_autofilter_enabled",
      FILTER_CATEGORIES:     "verilens_filter_categories",
      STATS:                 "verilens_stats",
      BACKEND_URL:           "verilens_backend_url",       // VideoVeritas (video deepfake)
      TEXT_BACKEND_URL:      "verilens_text_backend_url",  // Fast-DetectGPT (AI text)
      HOVER_DETECT_ENABLED:  "verilens_hover_detect_enabled",
      VIDEO_MAX_SECONDS:     "verilens_video_max_seconds",
    },

    // ── Default / seed values ─────────────────────────────────────────────────
    // Applied on extension install (service-worker onInstalled) for any key
    // that hasn't been set yet.
    DEFAULTS: {
      TIER:               "free",
      AUTOFILTER_ENABLED: false,
      HOVER_DETECT:       true,
      VIDEO_MAX_SECONDS:  20,
      BACKEND_URL:        "",          // fill in a stable URL if you have one
      TEXT_BACKEND_URL:   "",          // fill in a stable URL if you have one
    },

    // ── ngrok / API endpoints (optional pre-fill) ─────────────────────────────
    // If you have a long-running backend (not ephemeral ngrok), you can hardcode
    // the base URL here so users don't have to paste it in the popup every time.
    // Leave as "" to keep the popup-driven flow.
    ENDPOINTS: {
      VIDEO_BACKEND: "",   // e.g. "https://your-stable-video-api.example.com"
      TEXT_BACKEND:  "",   // e.g. "https://your-stable-text-api.example.com"
    },

    // ── ngrok auth token ──────────────────────────────────────────────────────
    // Used in the Kaggle notebook (fast-gpt.ipynb, videoveritas notebook) to
    // avoid the 2-hour session limit on the free ngrok tier.
    // Get yours at: https://dashboard.ngrok.com/get-started/your-authtoken
    NGROK: {
      AUTH_TOKEN: "",   // "YOUR_NGROK_AUTH_TOKEN_HERE"
    },

  };
})(globalThis);
