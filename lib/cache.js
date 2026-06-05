// lib/cache.js
// Small LOCAL mirror of verdicts, persisted in chrome.storage.local. This is a
// convenience cache only — the backend is authoritative. Its job: make a badge
// reappear instantly for a post I already scanned, and survive service-worker
// restarts (the worker has NO reliable in-memory state because MV3 kills it
// when idle).
//
// Keyed by `${kind}:${postId}` so a post's DEEPFAKE verdict and its FACT-CHECK
// verdict are stored independently and never overwrite each other.
//
// Eviction: LRU. Each entry stores a `ts` that we bump on read; when we exceed
// MAX entries we drop the least-recently-touched ones.
//
// Service-worker-only (not listed in content_scripts). Loaded via importScripts.
(function (g) {
  const KEY = "verilens_cache";
  const MAX = 200;

  function k(kind, postId) {
    return (kind || "deepfake") + ":" + postId;
  }

  async function load() {
    const o = await chrome.storage.local.get(KEY);
    return o[KEY] || {};
  }

  async function save(map) {
    await chrome.storage.local.set({ [KEY]: map });
  }

  // Returns the stored verdict object, or null. Touches ts (LRU) on hit.
  async function getVerdict(postId, kind) {
    const map = await load();
    const key = k(kind, postId);
    const entry = map[key];
    if (!entry) return null;
    entry.ts = Date.now();
    map[key] = entry;
    await save(map);
    return entry.verdict;
  }

  async function setVerdict(postId, verdict, kind) {
    const map = await load();
    map[k(kind, postId)] = { verdict, ts: Date.now() };

    const keys = Object.keys(map);
    if (keys.length > MAX) {
      // Oldest ts first; drop the overflow.
      keys.sort((a, b) => map[a].ts - map[b].ts);
      const overflow = keys.slice(0, keys.length - MAX);
      overflow.forEach((key) => delete map[key]);
    }
    await save(map);
  }

  async function clear() {
    await chrome.storage.local.remove(KEY);
  }

  g.VerilensCache = { getVerdict, setVerdict, clear };
})(globalThis);
