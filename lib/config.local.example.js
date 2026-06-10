// lib/config.local.example.js
// Template for lib/config.local.js (gitignored — never committed).
//
// Copy this file to lib/config.local.js and fill in the ngrok URLs printed by
// the two Kaggle notebooks (videoveritas-ai-video-detection.ipynb and
// fsd-image-detector.ipynb). Leave a value as "" to skip that backend — the
// extension falls back to its built-in mock model for that modality.
(function (g) {
  g.VerilensConfig = {
    videoBackendUrl: "", // VideoVeritas (video) — e.g. "https://xxxx.ngrok-free.app"
    imageBackendUrl: "", // FSD (image) — e.g. "https://yyyy.ngrok-free.app"
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
