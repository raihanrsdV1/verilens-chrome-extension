// lib/hash.js
// Stable contentHash from image URLs + caption text.
//
// Why a plain JS hash (FNV-1a) instead of crypto.subtle? crypto.subtle is
// async and overkill here. We only need a STABLE, deterministic identifier so
// the backend (and our mock) can recognise the same post again — not a secure
// digest. This runs identically in the service worker AND in content scripts,
// so the same post always produces the same hash everywhere.
//
// This file uses the IIFE-attach-to-globalThis pattern (no import/export) so it
// can be loaded both via `importScripts()` in the service worker and via the
// manifest `content_scripts` array in the page. `globalThis` is `self` in the
// worker and `window` in the content-script isolated world.
(function (g) {
  function fnv1a(str) {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime, 32-bit
    }
    // >>> 0 forces an unsigned 32-bit int, then hex-encode.
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function contentHash(imageUrls, captionText) {
    const imgs = Array.isArray(imageUrls) ? imageUrls : [];
    const basis = imgs.join("|") + "::" + (captionText || "");
    return "h_" + fnv1a(basis);
  }

  g.VerilensHash = { contentHash, fnv1a };
})(globalThis);
