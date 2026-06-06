// lib/cache.js
// LOCAL mirror of verdicts. The backend is authoritative; this just makes a
// badge reappear instantly for posts we already scanned and survives the
// service worker restarting.
//
// PERFORMANCE: this used to read+write the whole object in chrome.storage.local
// on EVERY call. During auto-filter scrolling that meant constant disk I/O on
// the service worker — and because the popup shares the worker's process, it
// made the popup slow/janky to open. So we now keep an in-memory map and only
// FLUSH to storage on a short debounce. Reads are instant (memory); writes are
// instant (memory) + a coalesced background flush.
//
// chrome.storage remains the durable backing: on a fresh worker the map lazy-
// loads from it. Losing the last <1s of un-flushed entries on an abrupt worker
// kill is fine — it's only a convenience cache (the backend will re-answer).
//
// Keyed by `${kind}:${postId}` so deepfake / factcheck / classify never collide.
// Service-worker-only (loaded via importScripts; NOT in content_scripts).
(function (g) {
  const KEY = "verilens_cache";
  const MAX = 200;
  const FLUSH_DELAY = 800; // ms — coalesce bursts of writes into one disk write

  let _map = null; // in-memory mirror; null until first load
  let _flushTimer = null;
  let _dirty = false;

  function k(kind, postId) {
    return (kind || "deepfake") + ":" + postId;
  }

  async function ensureLoaded() {
    if (_map) return _map;
    const o = await chrome.storage.local.get(KEY);
    _map = o[KEY] || {};
    return _map;
  }

  function scheduleFlush() {
    _dirty = true;
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flush();
    }, FLUSH_DELAY);
  }

  async function flush() {
    if (!_dirty || !_map) return;
    _dirty = false;

    // LRU eviction happens at flush time (cheap, and only on the persisted set).
    const keys = Object.keys(_map);
    if (keys.length > MAX) {
      keys.sort((a, b) => _map[a].ts - _map[b].ts);
      keys.slice(0, keys.length - MAX).forEach((key) => delete _map[key]);
    }
    await chrome.storage.local.set({ [KEY]: _map });
  }

  // ---- single ----
  async function getVerdict(postId, kind) {
    const map = await ensureLoaded();
    const entry = map[k(kind, postId)];
    return entry ? entry.verdict : null;
  }

  async function setVerdict(postId, verdict, kind) {
    const map = await ensureLoaded();
    map[k(kind, postId)] = { verdict, ts: Date.now() };
    scheduleFlush();
  }

  // ---- batched (auto-filter classify path) ----
  async function getManyVerdicts(postIds, kind) {
    const map = await ensureLoaded();
    const out = {};
    for (const id of postIds) {
      const entry = map[k(kind, id)];
      if (entry) out[id] = entry.verdict;
    }
    return out;
  }

  async function setManyVerdicts(entries, kind) {
    if (!entries.length) return;
    const map = await ensureLoaded();
    const now = Date.now();
    for (const { postId, verdict } of entries) {
      map[k(kind, postId)] = { verdict, ts: now };
    }
    scheduleFlush();
  }

  async function clear() {
    _map = {};
    _dirty = false;
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    await chrome.storage.local.remove(KEY);
  }

  g.VerilensCache = { getVerdict, setVerdict, getManyVerdicts, setManyVerdicts, flush, clear };
})(globalThis);
