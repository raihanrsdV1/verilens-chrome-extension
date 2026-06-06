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
  "lib/mockBackend.js"
);

const Cache = self.VerilensCache;
const Mock = self.VerilensMock;
const Tiers = self.VerilensTiers;

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

  // 2) Cache miss → real work. Simulate first-scan latency so the UI gets to
  //    show loading states. (Real backend will have its own latency here.)
  log("deepfake = cache miss; calling mock backend (tier:", tier + ")");
  await delay(400 + Math.floor(Math.random() * 500)); // 400–900ms

  const result = Mock.deepfake(payload, tier);
  result.cached = false;

  // 3) Persist to the mirror so the next scan is instant.
  await Cache.setVerdict(payload.postId, result, "deepfake");
  log("deepfake → returning result:", result);
  return result;
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

    case "CLASSIFY":
      handleClassify(msg.payload)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: String(e) }));
      return true;

    case "GET_TIER":
      getTier().then((tier) => sendResponse({ tier }));
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
  ]);
  const seed = {};
  if (o[TIER_KEY] === undefined) seed[TIER_KEY] = "free";
  if (o.verilens_autofilter_enabled === undefined) seed.verilens_autofilter_enabled = false;
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
