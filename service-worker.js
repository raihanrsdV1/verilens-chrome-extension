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

async function getTier() {
  const o = await chrome.storage.local.get(TIER_KEY);
  return o[TIER_KEY] || "free"; // default everyone to free
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ---- Deepfake scan ---------------------------------------------------------
async function handleDeepfake(payload) {
  // 1) Local mirror first → instant badge for already-scanned posts.
  const cachedVerdict = await Cache.getVerdict(payload.postId, "deepfake");
  if (cachedVerdict) {
    return { ...cachedVerdict, cached: true };
  }

  // 2) Cache miss → real work. Simulate first-scan latency so the UI gets to
  //    show loading states. (Real backend will have its own latency here.)
  const tier = await getTier();
  await delay(400 + Math.floor(Math.random() * 500)); // 400–900ms

  const result = Mock.deepfake(payload, tier);
  result.cached = false;

  // 3) Persist to the mirror so the next scan is instant.
  await Cache.setVerdict(payload.postId, result, "deepfake");
  return result;
}

// ---- Fact-check scan -------------------------------------------------------
async function handleFactcheck(payload) {
  const tier = await getTier();

  // Tier gate FIRST. Fact-check runs an expensive agent + search, so for free
  // users we short-circuit with an upgrade prompt and NEVER call the backend.
  if (!Tiers.isAllowed("factCheck", tier)) {
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
    return { ...cachedVerdict, cached: true };
  }

  await delay(500 + Math.floor(Math.random() * 700)); // 500–1200ms (agent is slower)

  const result = Mock.factcheck(payload);
  result.cached = false;

  await Cache.setVerdict(payload.postId, result, "factcheck");
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

// Set a sane default tier on install.
chrome.runtime.onInstalled.addListener(async () => {
  const o = await chrome.storage.local.get(TIER_KEY);
  if (!o[TIER_KEY]) await chrome.storage.local.set({ [TIER_KEY]: "free" });
});
