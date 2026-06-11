// website/docs/content.js
// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE SOURCE OF TRUTH for the /docs module.
//
// Everything the public /docs page and the admin panel render comes from this
// object. It is committed to git, so editing this file = a permanent, versioned
// change visible to everyone. The admin panel layers a localStorage overlay on
// top for live edits, and its "Export config" button regenerates this file so
// changes can be committed back. (See docs.js → effectiveConfig().)
//
// No build step, no framework — a plain global, same pattern as the rest of the
// codebase (window.VerilensDocs).
// ─────────────────────────────────────────────────────────────────────────────
window.VerilensDocs = {
  // Bump when you change the shape of this object (not the content).
  schemaVersion: 1,

  // ── ACCESS CONTROL & SCHEDULING ───────────────────────────────────────────
  // Client-side gate (showcase-grade, not a security boundary — there is no
  // server to enforce it; anyone can read this file). Good enough for a judging
  // window / investor preview on a static host.
  access: {
    enabled: true, // master ON/OFF. OFF → /docs shows a 403 "Not Available".
    useSchedule: true, // when true, also require now ∈ [start, end].
    start: "2026-06-10T00:00", // default publish window (local time)
    end: "2026-06-14T23:59",
    // Passphrase for the admin panel. NOT real security — change it, but know a
    // determined user can read it in source. Real protection needs a backend.
    adminPassphrase: "verilens-admin",
  },

  // ── PRODUCT META (drives the header + share card) ─────────────────────────
  product: {
    name: "Verilens",
    tagline: "Catch deepfakes & misinformation before you believe them.",
    oneLiner:
      "A Chrome extension that flags AI-generated media and verifies claims directly inside X, Instagram, and Facebook — four separate detectors, one click, no tab-switching.",
    // Fetched live from /manifest.json at runtime; this is only the fallback.
    versionFallback: "0.1.0",
    repo: "https://github.com/raihanrsdV1/verilens-chrome-extension",
  },

  // ── LIVE DATA SOURCES (pinged at runtime, shown with up/down status) ───────
  liveSources: {
    // Fetched relative to the site root so it works under python -m http.server
    // run from the repo root (docs page at /website/docs/ → /manifest.json).
    manifestUrl: "../../manifest.json",
    apis: [
      {
        name: "Claim Extractor",
        url: "https://verilens-claim-extractor.vercel.app/api/factcheck",
        method: "GET",
        note: "Vercel — extracts checkable claims from post text.",
      },
      {
        name: "Fact Verifier",
        url: "https://fact-verifier.vercel.app/api/verify",
        method: "GET",
        note: "Vercel — verifies a claim against trusted sources.",
      },
    ],
  },

  // ── YC-STYLE PITCH DECK ────────────────────────────────────────────────────
  // Order here is the render order; the admin panel can drag-reorder.
  pitch: [
    {
      id: "problem",
      title: "Problem",
      body:
        "Generative AI made it trivial to fabricate convincing images, video, voices, and text — and social feeds are where most people meet that content. The average user has no fast, trustworthy way to tell a real photo from a diffusion-model render, a genuine clip from a deepfake, or a human post from an LLM's. Existing detectors live on separate websites: you have to leave the feed, copy a URL, paste it, and interpret a single murky 'AI score.' By the time you've done that, you've already scrolled past — or already believed it.",
    },
    {
      id: "solution",
      title: "Solution",
      body:
        "Verilens puts forensic AI detection inside the feed. It adds lightweight controls to each post on X, Instagram, and Facebook, and runs FOUR independent detectors — image deepfake, video/audio deepfake, AI-text, and agentic fact-check — plus an automatic content filter and cryptographic provenance checks (C2PA / SynthID). Crucially, the capabilities never collapse into one number: you always see WHAT was flagged (image vs. video vs. claim) and WHY, with a green / amber / red band and a plain-language explanation.",
    },
    {
      id: "why-now",
      title: "Why Now",
      body:
        "Three curves crossed. (1) Generative models went mainstream and near-free, so synthetic media volume is exploding across every platform. (2) Provenance standards matured — C2PA Content Credentials and Google SynthID are now emitted by major generators, making local verification possible without a server round-trip. (3) Browser ML and host-permission APIs got good enough to run real forensic pipelines from an extension. The detection layer can finally live where the content does: in the browser, in the feed.",
    },
    {
      id: "product",
      title: "Product Demo",
      body:
        "Hover any image or video → an instant deepfake badge appears in the corner. Click 'Check media' under a post → the image/video is scored by a real forensic model and you get a banded verdict with provenance. Click 'Fact-check' → an agent extracts the post's claims, verifies each against trusted sources, and rates confidence with links. Select any text → 'Check AI' tells you how likely it was machine-written. Turn on Auto Filter → flagged posts blur as you scroll, each with 'Show anyway.' All of it inside the page, in Shadow DOM so it never breaks the site.",
    },
    {
      id: "market",
      title: "Market Opportunity",
      body:
        "Every social-media user is a potential user — billions of people who scroll feeds daily. The sharpest early wedges are the people who get burned by fakes first: journalists and fact-checkers, OSINT and trust-&-safety teams, educators, brand-safety and moderation roles, and creators protecting their likeness. As synthetic-media disclosure regulation tightens (EU AI Act, platform labeling mandates), 'is this real?' shifts from a nice-to-have to an expectation built into the browsing surface itself.",
    },
    {
      id: "business-model",
      title: "Business Model",
      body:
        "Freemium, with a clean value split. FREE forever: image deepfake detection + C2PA/SynthID provenance on X, Instagram, and Facebook — genuinely useful, zero friction, drives installs. PRO ($6.99/mo or $59/yr): the heavy-compute capabilities — video & audio deepfake analysis, the agentic fact-checker, auto content filtering, AI-text detection, and hover-to-scan. The paywall lives in one file (lib/tiers.js) and is enforced authoritatively in the service worker, so the boundary is a single source of truth. Future: team/newsroom seats and an API.",
    },
    {
      id: "traction",
      title: "Traction",
      body:
        "Working end-to-end across all three platforms with a shared adapter layer. Real model backends are live, not mocked: VideoVeritas (Qwen3-VL video real-vs-AI) and FSD (CVPR'25 image forensics) served from Kaggle T4s via ngrok, Fast-DetectGPT (gpt-neo-2.7B) for AI-text, and two deployed Vercel APIs powering the fact-check agent. A built-in deterministic mock backend means every action ALWAYS returns a result, so the product demos cleanly even when a model server is asleep.",
    },
    {
      id: "competition",
      title: "Competition",
      body:
        "Standalone detector sites (AI-or-Not, Hive Moderation, Reality Defender) and a handful of single-modality browser plugins. They share three weaknesses Verilens is built against: they make you LEAVE the feed, they fold everything into ONE opaque score, and they ignore cryptographic provenance. Verilens is in-feed, keeps every modality separate and explained, and checks C2PA/SynthID locally — a definitive signal others treat as an afterthought.",
    },
    {
      id: "advantage",
      title: "Unique Advantage",
      body:
        "(1) Separation of concerns — four detectors that never merge into a single misleading number. (2) Provenance-first — local C2PA/SynthID parsing gives a verified 'confirmed AI' answer with no model guesswork and no network call. (3) Platform-agnostic adapters — all DOM knowledge is isolated, so adding a platform is one file. (4) Graceful degradation — a deterministic mock backend guarantees a response, so the UX never dead-ends. (5) Privacy by construction — detection only runs on explicit action; provenance is local; nothing is stored or sold.",
    },
    {
      id: "gtm",
      title: "Go-To-Market",
      body:
        "Land via the Chrome Web Store with a free tier strong enough to share. Seed with the communities that feel the pain first — journalism/OSINT/fact-checking circles, trust-&-safety practitioners, and creator communities worried about likeness theft. Extensions spread by demonstration: a badge appearing on a viral fake IS the ad. Convert free → Pro at the moment of need (the first time someone hits a gated video check on a suspicious clip). Expand into newsroom/team seats and a developer API.",
    },
    {
      id: "vision",
      title: "Vision",
      body:
        "A trust layer for the open web. Verilens starts on three social platforms, but the thesis generalizes: anywhere people consume media, they should be able to ask 'is this real?' and get a fast, explained, provenance-aware answer without leaving the page. The endgame is an ambient, modality-aware authenticity signal — built into the browsing surface, privacy-preserving by default, and trusted because it shows its work.",
    },
  ],

  // ── TEAM (MANDATORY) ───────────────────────────────────────────────────────
  // Seeded from git contributors — ROLES ARE BEST-GUESS PLACEHOLDERS, edit in the
  // admin panel. `photo` is a data-URL (set via admin upload, auto-resized) or "";
  // empty → an initials avatar is generated.
  team: {
    name: "Team Verilens · BUET CSE",
    members: [
      {
        name: "Mehemud Azad",
        role: "ML / Detection Models",
        email: "2105014@ugrad.cse.buet.ac.bd",
        photo: "",
      },
      {
        name: "Shah Mohammad Abdul Mannan",
        role: "Backend / Fact-Check APIs",
        email: "2105056@ugrad.cse.buet.ac.bd",
        photo: "",
      },
      {
        name: "Ahnaf Tahmid",
        role: "Extension Core / Config & Integration",
        email: "2105041@ugrad.cse.buet.ac.bd",
        photo: "",
      },
      {
        name: "Mohammad Raihan Rashid",
        role: "Frontend / Popup & Website",
        email: "2105046@ugrad.cse.buet.ac.bd",
        photo: "",
      },
      {
        name: "Dipit Saha",
        role: "Product / Platform Adapters",
        email: "2105050@ugrad.cse.buet.ac.bd",
        photo: "",
      },
    ],
  },

  // ── PRODUCT OVERVIEW ───────────────────────────────────────────────────────
  overview: {
    what:
      "A Manifest V3 Chrome extension that detects AI-generated media and misinformation in-place on social feeds (X/Twitter, Instagram, Facebook). It injects per-post controls and a hover badge, runs detection on demand, and renders banded, explained verdicts in isolated Shadow DOM.",
    targetUsers:
      "Everyday scrollers who want a sanity check; journalists, fact-checkers, and OSINT/trust-&-safety teams who need it fast and in-context; educators and researchers studying synthetic media; creators guarding their likeness.",
    useCases: [
      "Spot an AI-generated image before resharing it.",
      "Judge whether a viral video clip is a deepfake.",
      "Fact-check a confident-sounding claim against sources.",
      "Check whether a wall of text was written by an LLM.",
      "Auto-blur AI memes / misinformation / sensitive posts while scrolling.",
      "Confirm 'made with AI' instantly via C2PA / SynthID provenance.",
    ],
  },

  // ── FEATURE MATRIX (status synced conceptually with lib/tiers.js) ──────────
  features: [
    { name: "Image deepfake detection", tier: "Free", status: "live", note: "FSD forensic model + mock fallback" },
    { name: "C2PA / SynthID provenance", tier: "Free", status: "live", note: "Parsed locally in the browser" },
    { name: "Video & audio deepfake analysis", tier: "Pro", status: "live", note: "VideoVeritas multimodal model" },
    { name: "AI fact-checking agent", tier: "Pro", status: "live", note: "Vercel claim-extract + verify APIs" },
    { name: "AI text detection", tier: "Pro", status: "live", note: "Fast-DetectGPT (gpt-neo-2.7B)" },
    { name: "Auto content filter", tier: "Pro", status: "live", note: "Classify-on-view, blur + 'show anyway'" },
    { name: "Hover-to-scan badge", tier: "Pro", status: "live", note: "400ms hover intent → corner badge" },
    { name: "Team / newsroom seats", tier: "Pro", status: "planned", note: "Shared settings + audit log" },
    { name: "Developer API", tier: "Pro", status: "planned", note: "Programmatic detection endpoint" },
    { name: "More platforms (TikTok, Reddit)", tier: "—", status: "upcoming", note: "New adapter per platform" },
  ],

  // ── ARCHITECTURE & DATA-FLOW (Mermaid sources, editable in admin) ──────────
  diagrams: {
    architecture: `flowchart TD
  subgraph Browser["Browser (in-page)"]
    CS["Content scripts<br/>adapters · actions · filter · hover · textSelection"]
    POP["Popup UI<br/>settings · stats · master switch"]
  end
  SW["Service Worker<br/>message router · tier gate · LRU cache · stats"]
  subgraph Models["Detection backends"]
    MOCK["Mock backend<br/>(deterministic fallback)"]
    VV["VideoVeritas<br/>Kaggle T4 + ngrok"]
    FSD["FSD image forensics<br/>Kaggle + ngrok"]
    FDG["Fast-DetectGPT<br/>Kaggle + ngrok"]
  end
  VAPI["Vercel APIs<br/>claim-extractor · fact-verifier"]
  STORE["chrome.storage.local<br/>tier · settings · cache · stats"]

  CS -->|messages| SW
  POP -->|settings| STORE
  SW -->|gate + cache| STORE
  SW --> MOCK
  SW --> VV
  SW --> FSD
  SW --> FDG
  SW --> VAPI`,
    dataflow: `flowchart LR
  A["Post appears<br/>in feed"] --> B["Adapter extracts<br/>media + text"]
  B --> C["Stable content hash"]
  C --> D{"Cache hit?"}
  D -- yes --> H["Render badge"]
  D -- no --> E["Tier gate<br/>(service worker)"]
  E --> F["Detector<br/>image / video / text / factcheck"]
  F --> G["Verdict<br/>band + explanation"]
  G --> STORE["Cache result"]
  G --> H
  H --> I["User: Show anyway /<br/>re-check / dismiss"]`,
  },

  // ── TECHNOLOGY STACK ───────────────────────────────────────────────────────
  stack: {
    Frontend: [
      "Vanilla JS (no framework, no build step)",
      "Shadow DOM for injected UI isolation",
      "CSS custom properties (light/dark)",
    ],
    Extension: [
      "Manifest V3",
      "Service worker (classic, importScripts)",
      "Content scripts + IIFE-on-globalThis modules",
      "chrome.storage.local (state + LRU cache)",
    ],
    AI: [
      "FSD — Forensic Self-Descriptions (CVPR'25), image",
      "VideoVeritas — Qwen3-VL real-vs-AI, video",
      "Fast-DetectGPT (gpt-neo-2.7B), text",
      "C2PA / SynthID provenance parsing (local)",
    ],
    Backend: [
      "vLLM OpenAI-compatible server (video)",
      "FastAPI micro-servers (image, text)",
      "Vercel serverless functions (fact-check)",
    ],
    Infra: [
      "Kaggle T4 GPUs (model hosting)",
      "ngrok tunnels (model exposure)",
      "Vercel (fact-check APIs)",
      "Static site (this /docs) via http.server / GitHub Pages",
    ],
  },

  // ── API DOCUMENTATION ──────────────────────────────────────────────────────
  apis: {
    consumed: [
      {
        name: "VideoVeritas (video)",
        endpoint: "POST {ngrok}/v1/chat/completions",
        auth: "None (ngrok header: ngrok-skip-browser-warning)",
        io: "OpenAI-style messages w/ video_url or frames → verdict in <answer>…</answer>",
      },
      {
        name: "FSD (image)",
        endpoint: "POST {ngrok}/detect",
        auth: "None (ngrok header)",
        io: "{ image_b64 } → { is_fake, score }",
      },
      {
        name: "Fast-DetectGPT (text)",
        endpoint: "POST {ngrok}/detect-text",
        auth: "None (ngrok header)",
        io: "{ text } → { ai_probability, criterion, tokens }",
      },
      {
        name: "Claim Extractor (fact-check)",
        endpoint: "POST https://verilens-claim-extractor.vercel.app/api/factcheck",
        auth: "None",
        io: "{ text } → { claims[] }",
      },
      {
        name: "Fact Verifier (fact-check)",
        endpoint: "POST https://fact-verifier.vercel.app/api/verify",
        auth: "None",
        io: "{ claim } → { verdict, confidence, sources[] }",
      },
    ],
    // The extension's own internal message contracts (service-worker router).
    internal: [
      { type: "SCAN_DEEPFAKE", desc: "Image/video deepfake scan for one post." },
      { type: "SCAN_FACTCHECK", desc: "Agentic claim extraction + verification." },
      { type: "DETECT_TEXT", desc: "AI-text probability for a selection." },
      { type: "CLASSIFY", desc: "Cheap batch classifier for the auto-filter." },
      { type: "GET_TIER / SET_TIER", desc: "Read / switch free|premium tier." },
    ],
  },

  // ── DATA LAYER ─────────────────────────────────────────────────────────────
  dataLayer: {
    sources:
      "Media URLs and caption text scraped from the live DOM by per-platform adapters (X/IG/FB). The service worker re-fetches media itself (host-permission CORS bypass) to send to models. Video pixels for MSE players are captured frame-by-frame off the <video> via canvas.",
    storage:
      "chrome.storage.local only — tier, settings, session stats, and an LRU verdict cache (max 200, keyed by content hash). No external database. No server-side user record.",
    privacy:
      "Detection runs only on explicit user action (or opt-in hover). Provenance is parsed locally. Nothing is persisted off-device or sold; the cache is local and capped; clearing storage wipes all state.",
  },

  // ── AI LAYER ───────────────────────────────────────────────────────────────
  aiLayer: {
    models:
      "FSD (image forensics), VideoVeritas (Qwen3-VL video), Fast-DetectGPT (gpt-neo-2.7B text). Each is a single-purpose detector — no shared 'AI score.'",
    personalization:
      "None by design — detection is content-intrinsic, not user-profiled. Personalization is limited to user-chosen filter categories and tier.",
    explainability:
      "Every verdict carries a green/amber/red band, a probability, and a plain-language reason. Provenance results say which standard matched (C2PA vs. SynthID). The fact-checker returns per-claim sources so conclusions are auditable.",
  },

  // ── ROADMAP ────────────────────────────────────────────────────────────────
  roadmap: {
    short: [
      "Polish onboarding + first-run explainer",
      "Persist real model URLs via signed config",
      "Tighten video frame-capture on more players",
    ],
    mid: [
      "TikTok + Reddit adapters",
      "Team / newsroom shared settings",
      "Confidence calibration across detectors",
    ],
    long: [
      "Developer API for programmatic detection",
      "Cross-browser (Firefox / Edge) builds",
      "Ambient provenance across arbitrary sites",
    ],
  },

  // ── PERFORMANCE & SCALABILITY ──────────────────────────────────────────────
  performance: {
    load:
      "Detection is on-demand, not feed-wide, so cost scales with user clicks, not impressions. The auto-filter classifies a post once when it enters the viewport, then caches it.",
    optimization:
      "LRU verdict cache (max 200) with a debounced flush; content hashing to dedupe re-scans; downscaled video frames (≤480px) and capped byte sizes before model calls; a deterministic mock keeps latency-sensitive demos instant.",
  },

  // ── SECURITY ───────────────────────────────────────────────────────────────
  security: {
    auth:
      "No accounts. Tier (free/premium) lives in chrome.storage; in production, Pro unlock would be signed server-side. The /docs admin gate is a client-side passphrase — showcase-grade, not a security boundary.",
    rbac:
      "Single authoritative gate: lib/tiers.js defines capabilities, enforced in the service worker (UI locks are cosmetic). Admin vs. public for /docs is a visibility toggle + schedule.",
    dataProtection:
      "Minimal data footprint: local-only storage, no PII collected, provenance parsed locally, media fetched transiently for a scan and not retained.",
  },

  // ── ANALYTICS ──────────────────────────────────────────────────────────────
  analytics: {
    kpis: [
      "Installs & weekly active users",
      "Free → Pro conversion rate",
      "Detections per user per week",
      "% media flagged AI (by modality)",
      "Auto-filter posts hidden",
    ],
    metricsNote:
      "Session counters (media checks, fact-checks, confirmed-AI, filtered) are tracked locally in chrome.storage and shown in the popup. Aggregate product analytics would be opt-in and anonymized.",
  },

  // ── CHANGELOG ──────────────────────────────────────────────────────────────
  changelog: [
    {
      version: "0.1.0",
      date: "2026-06",
      notes: [
        "Three-platform support (X, Instagram, Facebook)",
        "Four detectors live + deterministic mock fallback",
        "Real backends: VideoVeritas, FSD, Fast-DetectGPT, Vercel fact-check",
        "Auto content filter, hover-to-scan, C2PA/SynthID provenance",
        "Config via lib/config.local.js; redesigned popup; marketing site + this /docs",
      ],
    },
  ],
};
