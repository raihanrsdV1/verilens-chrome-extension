// lib/mockBackend.js
// Fake backend so the extension is fully testable before the real AI exists.
// Every response shape here MUST match the real BACKEND CONTRACTS exactly, so
// swapping in real fetch() calls later changes nothing in the UI.
//
// Determinism: results are derived from contentHash, so the SAME post always
// returns the SAME verdict. That makes the UI predictable while building.
//
// Note: this module does NOT add the network delay or the cache flag. The
// service worker owns those (it only calls the mock on a cache MISS, and adds
// the 400–900ms delay there), which is exactly how the real backend split will
// work too.
(function (g) {
  const Tiers = g.VerilensTiers;

  // Turn a contentHash into a stable 0..1 number.
  function seed01(contentHash) {
    const hex = String(contentHash || "").replace(/[^0-9a-f]/gi, "");
    const n = parseInt(hex.slice(-8), 16);
    return Number.isFinite(n) ? (n % 1000) / 1000 : 0;
  }

  const EXPLAIN = {
    green:
      "No strong signs of AI generation were found in this image. Lighting, edges, and texture look consistent with a real photo.",
    amber:
      "Some signals are ambiguous. There are minor artifacts that can appear in both edited and AI-generated images, so this is inconclusive.",
    red:
      "Multiple indicators point to AI generation or heavy manipulation, including unnatural textures and inconsistent fine detail.",
  };

  // ---- /deepfake -----------------------------------------------------------
  // tier gates video/audio: free tier gets { available:false, reason:"premium_required" }
  function deepfake(payload, tier) {
    const r = seed01(payload.contentHash);

    let band, verdict, prob;
    if (r < 0.45) {
      band = "green";
      verdict = "likely_real";
      prob = 0.04 + r * 0.25; // ~0.04–0.15
    } else if (r < 0.75) {
      band = "amber";
      verdict = "uncertain";
      prob = 0.4 + (r - 0.45) * 0.6; // ~0.40–0.58
    } else {
      band = "red";
      verdict = "likely_ai";
      prob = 0.82 + (r - 0.75) * 0.6; // ~0.82–0.97
    }
    prob = Math.min(0.99, Math.round(prob * 100) / 100);

    const hasImage = (payload.imageUrls || []).length > 0;
    const videoAllowed = Tiers.isAllowed("deepfakeVideo", tier) && payload.hasVideo;
    const audioAllowed = Tiers.isAllowed("deepfakeAudio", tier) && payload.hasAudio;

    return {
      postId: payload.postId,
      // `cached` is set by the worker, not here.
      media: {
        // Only report an image verdict when the post actually has an image.
        image: hasImage
          ? { aiGenerated: prob, verdict }
          : { available: false, reason: "no_image" },
        video: payload.hasVideo
          ? videoAllowed
            ? { available: true, aiGenerated: prob, verdict }
            : { available: false, reason: "premium_required" }
          : { available: false, reason: "no_video" },
        audio: payload.hasAudio
          ? audioAllowed
            ? { available: true, aiGenerated: prob, verdict }
            : { available: false, reason: "premium_required" }
          : { available: false, reason: "no_audio" },
      },
      band,
      explanation: EXPLAIN[band],
    };
  }

  // ---- /factcheck ----------------------------------------------------------
  // PAID feature. The worker guarantees we are only called for premium users,
  // so there is no tier logic here. Deterministic from contentHash.
  const VERDICT_POOL = ["corroborated", "contradicted", "unverifiable", "developing"];

  const SOURCES = [
    {
      outlet: "Reuters",
      url: "https://www.reuters.com/fact-check/",
      summary: "Reuters reporting on the underlying figures and their context.",
    },
    {
      outlet: "Associated Press",
      url: "https://apnews.com/hub/ap-fact-check",
      summary: "AP's review of the claim against primary records.",
    },
    {
      outlet: "AFP Fact Check",
      url: "https://factcheck.afp.com/",
      summary: "AFP traced the original source of the assertion.",
    },
  ];

  function factcheck(payload) {
    const r = seed01(payload.contentHash);

    let overall;
    if (r < 0.35) overall = "mostly_true";
    else if (r < 0.6) overall = "mixed";
    else if (r < 0.8) overall = "mostly_false";
    else overall = "unverifiable";

    // Primary claim mirrors the caption; verdict aligns with the overall call.
    const caption = (payload.captionText || "").trim();
    const primaryClaimText =
      (caption ? caption.slice(0, 140) : "The central assertion in this post") +
      (caption.length > 140 ? "…" : "");

    const overallToVerdict = {
      mostly_true: "corroborated",
      mixed: "developing",
      mostly_false: "contradicted",
      unverifiable: "unverifiable",
    };

    // A second, secondary claim with an independently-seeded verdict so the UI
    // shows claim-level granularity (not one merged number).
    const secondSeed = Math.floor(r * 1000);
    const secondVerdict = VERDICT_POOL[secondSeed % VERDICT_POOL.length];

    const conf = (base) => Math.min(0.97, Math.round((base + r * 0.35) * 100) / 100);

    const claims = [
      {
        claim: primaryClaimText,
        verdict: overallToVerdict[overall],
        confidence: conf(0.55),
        sources: [SOURCES[secondSeed % SOURCES.length], SOURCES[(secondSeed + 1) % SOURCES.length]],
      },
      {
        claim: "Supporting details and figures cited alongside the main claim.",
        verdict: secondVerdict,
        confidence: conf(0.45),
        sources: [SOURCES[(secondSeed + 2) % SOURCES.length]],
      },
    ];

    const overallExplain = {
      mostly_true: "Independent sources broadly support the main claim, with minor caveats on detail.",
      mixed: "The post mixes accurate and unsupported elements; key specifics remain in dispute.",
      mostly_false: "Trusted sources contradict the central claim or its framing.",
      unverifiable: "There isn't yet enough reliable sourcing to confirm or refute this.",
    };

    return {
      postId: payload.postId,
      // `cached` is set by the worker, not here.
      claims,
      overall,
      explanation: overallExplain[overall],
    };
  }

  // ---- /classify (auto-filter, CHEAP path) ---------------------------------
  // This is the lightweight classifier that runs automatically on every post.
  // It must NEVER do the heavy deepfake/factcheck work — it just tags posts.
  // Deterministic from contentHash, and tuned so a realistic mix of categories
  // (including plenty of UNFLAGGED posts) shows up across a feed.
  const CATEGORIES = ["political", "ai_meme", "ai_generated", "misinformation"];

  function classifyOne(post) {
    const r = seed01(post.contentHash);
    const labels = [];

    // Primary bucket. MOST posts (~68%) stay UNFLAGGED so the feed isn't a wall
    // of blur — only ~32% get a category, which is far more realistic.
    if (r < 0.12) labels.push("political");
    else if (r < 0.2) labels.push("ai_meme");
    else if (r < 0.27) labels.push("ai_generated");
    else if (r < 0.32) labels.push("misinformation");

    // A rare post carries a second label, to exercise multi-category UI.
    if (r > 0.97) labels.push("ai_generated", "misinformation");

    return {
      postId: post.postId,
      labels: Array.from(new Set(labels)),
      confidence: Math.round((0.55 + r * 0.4) * 100) / 100,
    };
  }

  // payload = { posts: [ { postId, contentHash, captionText, imageUrls } ] }
  function classify(payload) {
    const posts = (payload && payload.posts) || [];
    return { results: posts.map(classifyOne) };
  }

  g.VerilensMock = { deepfake, factcheck, classify, CATEGORIES };
})(globalThis);
