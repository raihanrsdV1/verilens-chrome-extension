// lib/tiers.js
// SINGLE SOURCE OF TRUTH for what each tier is allowed to do.
// To change the paywall, edit ONLY this file.
//
// Loaded in both the service worker (importScripts) and content scripts
// (manifest), so gating logic is identical on both sides.
(function (g) {
  const TIER_RULES = {
    free: {
      deepfakeImage: true,
      deepfakeVideo: false,
      deepfakeAudio: false,
      factCheck: false,
      autoFilter: false,
      detectText: false,
    },
    premium: {
      deepfakeImage: true,
      deepfakeVideo: true,
      deepfakeAudio: true,
      factCheck: true,
      autoFilter: true,
      detectText: true,
    },
  };

  // isAllowed("deepfakeVideo", "free") -> false
  function isAllowed(feature, tier) {
    const rules = TIER_RULES[tier] || TIER_RULES.free;
    return rules[feature] === true;
  }

  g.VerilensTiers = { TIER_RULES, isAllowed };
})(globalThis);
