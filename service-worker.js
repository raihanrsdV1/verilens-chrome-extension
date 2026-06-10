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
  "lib/config.js",
  "lib/provenanceLocalMock.js",
  "lib/provenanceLocal.js",
  "lib/mockBackend.js"
);

const Cache = self.VerilensCache;
const Mock = self.VerilensMock;
const Tiers = self.VerilensTiers;
const Provenance = self.VerilensProvenance;
const Config = self.VerilensConfig;

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

// Session stats shown in the popup. Small object, incremented on real work only
// (never on cache hits, to avoid inflating counts on re-scans).
async function bumpStat(key, n = 1) {
  const o = await chrome.storage.local.get("verilens_stats");
  const s = o.verilens_stats || {};
  s[key] = (s[key] || 0) + n;
  await chrome.storage.local.set({ verilens_stats: s });
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

  // 2) STAGE A — LOCAL provenance pre-check (C2PA). No model, no backend. A
  //    signed credential declaring AI is authoritative → confirm instantly and
  //    skip the pipeline entirely. ABSENCE proves nothing → fall through.
  const prov = await Provenance.check(payload);
  if (prov.state === "present" && prov.standard === "c2pa") {
    log("deepfake = STAGE A HIT (C2PA present) — backend SKIPPED, source:", prov.source);
    const confirmedResult = buildC2PAConfirmed(payload, prov);
    confirmedResult.cached = false;
    await Cache.setVerdict(payload.postId, confirmedResult, "deepfake");
    await bumpStat("deepfakeScans");
    await bumpStat("confirmedAI");
    return confirmedResult;
  }

  // 3) STAGE B — backend (mock). Simulate first-scan latency so the UI gets to
  //    show loading states. (Real backend runs SynthID + the heavy pipeline.)
  log("deepfake = Stage A absent; calling backend (tier:", tier + ")");
  await delay(400 + Math.floor(Math.random() * 500)); // 400–900ms

  const result = Mock.deepfake(payload, tier);
  result.cached = false;

  await Cache.setVerdict(payload.postId, result, "deepfake");
  await bumpStat("deepfakeScans");
  if (result.confirmed) await bumpStat("confirmedAI");
  log("deepfake → returning result:", result);
  return result;
}

// Build a high-confidence "Confirmed AI" verdict from a local C2PA hit. No model
// numbers are invented — the credential itself is the evidence.
function buildC2PAConfirmed(payload, prov) {
  return {
    postId: payload.postId,
    band: "red",
    confirmed: "c2pa",
    provenance: { c2pa: "present", synthid: "not_checked", source: prov.source },
    media: {
      image: { available: true, aiGenerated: 0.99, verdict: "likely_ai" },
      video: payload.hasVideo
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_video" },
      audio: payload.hasAudio
        ? { available: false, reason: "not_checked" }
        : { available: false, reason: "no_audio" },
    },
    explanation:
      "This image carries signed C2PA Content Credentials declaring it was generated or edited with AI. That's a verifiable provenance signal — no model guess needed.",
  };
}

// ---- Fact-check scan -------------------------------------------------------
async function handleFactcheck(payload) {
  log("factcheck ← received payload:", payload);
  const tier = await getTier();

  if (!Tiers.isAllowed("factCheck", tier)) {
    log("factcheck = GATED (tier:", tier + ") — backend NOT called");
    return {
      gated: true,
      feature: "factCheck",
      message:
        "Fact-check runs an AI agent that verifies claims against trusted sources. Upgrade to Premium to use it.",
    };
  }

  const cachedVerdict = await Cache.getVerdict(payload.postId, "factcheck");
  if (cachedVerdict) {
    log("factcheck = CACHE HIT for postId", payload.postId);
    return { ...cachedVerdict, cached: true };
  }

  log("factcheck = cache miss; calling real API at", Config.FACTCHECK_API);

  const apiPayload = {
    postId: payload.postId,
    captionText: payload.captionText || "",
    imageUrls: payload.imageUrls || [],
  };

  if (payload.videoFrames && payload.videoFrames.length > 0) {
    apiPayload.videoFrames = payload.videoFrames;
  }

  if (payload.videoUrl) {
    apiPayload.videoUrl = payload.videoUrl;
  }
  if (payload.audioUrl) {
    apiPayload.audioUrl = payload.audioUrl;
  }

  try {
    const response = await fetch(Config.FACTCHECK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apiPayload),
      signal: AbortSignal.timeout(290000),
    });

    if (!response.ok) {
      let errMsg = `API HTTP ${response.status}`;
      try { const j = await response.json(); errMsg = j.error || errMsg; } catch {}
      throw new Error(errMsg);
    }

    const extractResult = await response.json();
    const claims = extractResult.claims || [];

    // Step 2: verify extracted claims against web evidence
    if (claims.length > 0) {
      log("factcheck → verifying " + claims.length + " claim(s) via", Config.VERIFY_API);
      try {
        const verifyResponse = await fetch(Config.VERIFY_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId: payload.postId, claims: claims }),
          signal: AbortSignal.timeout(290000),
        });

        if (verifyResponse.ok) {
          const verifyResult = await verifyResponse.json();
          // Merge verification verdicts back into the extraction result
          extractResult.claims = verifyResult.claims || claims;
          extractResult.overall = verifyResult.overall || extractResult.overall;
          extractResult.explanation = verifyResult.explanation || extractResult.explanation;
          log("factcheck → verified: overall=" + extractResult.overall);
        } else {
          log("factcheck → verify API returned", verifyResponse.status, "(using unverified claims)");
        }
      } catch (verifyErr) {
        log("factcheck → verify API error:", verifyErr.message, "(using unverified claims)");
      }
    }

    extractResult.cached = false;

    await Cache.setVerdict(payload.postId, extractResult, "factcheck");
    await bumpStat("factCheckScans");
    log("factcheck → returning result:", extractResult);
    return extractResult;
  } catch (e) {
    log("factcheck = API ERROR:", e.message);
    return {
      postId: payload.postId,
      cached: false,
      error: true,
      message: `Fact-check backend unavailable: ${e.message}`,
      claims: [],
      overall: "unverifiable",
      explanation: "The fact-check backend could not be reached. Try again later.",
    };
  }
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
    const byId = new Map(fresh.map((r) => [r.postId, r]));

    // LOCAL C2PA on the filter path: it's free and instant (no API), so we run
    // it on every post here. A signed credential is a definitive "ai_generated"
    // signal — add the label even if the cheap classifier missed it.
    await Promise.all(
      toClassify.map(async (p) => {
        const r = byId.get(p.postId);
        if (!r) return;
        const prov = await Provenance.check(p);
        if (prov.state === "present" && prov.standard === "c2pa") {
          if (!r.labels.includes("ai_generated")) r.labels.push("ai_generated");
          r.provenance = "c2pa"; // mark the source so the filter can show "Confirmed"
        }
      })
    );

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

// ---- AI Text Detection -----------------------------------------------------
async function handleDetectText(payload) {
  log("detectText ← received payload:", payload);
  const tier = await getTier();

  if (!Tiers.isAllowed("detectText", tier)) {
    log("detectText = GATED (tier:", tier + ") — backend NOT called");
    return {
      gated: true,
      feature: "detectText",
      message: "AI text detection is a premium feature. Upgrade to Premium to analyze highlighted text.",
    };
  }

  const cachedVerdict = await Cache.getVerdict(payload.textHash, "detectText");
  if (cachedVerdict) {
    log("detectText = CACHE HIT for textHash", payload.textHash);
    return { ...cachedVerdict, cached: true };
  }

  log("detectText = cache miss; calling mock backend");
  await delay(400 + Math.floor(Math.random() * 500)); // 400–900ms

  const result = Mock.detectText(payload);
  result.cached = false;

  await Cache.setVerdict(payload.textHash, result, "detectText");
  await bumpStat("detectTextScans");
  log("detectText → returning result:", result);
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

    case "DETECT_TEXT":
      handleDetectText(msg.payload)
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
