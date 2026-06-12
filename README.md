<div align="center">

# 🛡 Verilens

### Deepfake & misinformation detection, right inside your social feed.

Verilens is a Manifest V3 browser extension that flags **AI‑generated media** and **misinformation** on X/Twitter, Instagram, and Facebook — combining verifiable content provenance, multimodal deepfake models, and agentic fact‑checking behind a clean, unobtrusive UI.

</div>

---

## Table of contents

- [Overview](#overview)
- [Capabilities](#capabilities)
- [How detection works](#how-detection-works)
- [Provenance‑first design](#provenance-first-design)
- [Tiers](#tiers)
- [Supported platforms](#supported-platforms)
- [Installation](#installation)
- [Usage](#usage)
- [Connecting the real AI models](#connecting-the-real-ai-models)
- [Marketing site & live `/docs`](#marketing-site--live-docs)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Integration contracts](#integration-contracts)
- [Engineering notes](#engineering-notes)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Synthetic media and coordinated misinformation now spread faster than people can vet them. Verilens brings verification to the point of consumption: as you scroll, it attaches a quiet **🛡 Verilens** control to each post so you can check media or claims on demand, and — for subscribers — automatically blurs flagged content before you ever engage with it.

The extension is privacy‑respecting and standards‑aware: it parses open **C2PA / Content Credentials** locally for instant, verifiable answers, and only escalates to hosted AI models when provenance is inconclusive. Heavy AI never runs on every post — manual checks are user‑triggered, and automatic filtering uses a deliberately cheap path.

---

## Capabilities

Verilens has **three distinct capabilities** — separate features, separate costs, separate UI. They are never merged into a single "score."

| Capability | Trigger | What it does |
|---|---|---|
| **Deepfake detection** | Manual — *Check media* on a post | Determines whether an image, video, or audio clip is AI‑generated or manipulated, with a confidence band and plain‑English explanation. |
| **Fact‑check** | Manual — *Fact‑check* on a post | Runs an agentic verifier that checks the post's claims against trusted sources and returns claim‑level verdicts with citations. |
| **Content filtering** | Automatic — as posts appear | Classifies posts via a lightweight model and blurs flagged categories in place, with a one‑tap *Show anyway*. |

Plus **AI text detection**: select text on a page to assess whether it was AI‑generated (powered by a Fast‑DetectGPT backend).

Design principles:

- **Expensive pipelines never run automatically.** Deepfake and fact‑check are always user‑initiated.
- **Automatic filtering uses the cheap path only** — never the full deepfake or fact‑check pipeline.
- **Deepfake and fact‑check results are shown separately**, never collapsed into one number.
- **Premium‑gated actions show an upgrade prompt**, never a silent failure.

---

## How detection works

A *Check media* request resolves through a provenance‑first pipeline that escalates only as far as it needs to:

```
Check media (image)
   │
   ├─ Stage A · LOCAL C2PA      signed credential declares AI?  → ✓ Confirmed AI (instant, no backend)
   │
   ├─ Stage B · BACKEND SynthID  watermark detected?            → ✓ Confirmed AI
   │
   └─ Both inconclusive          → deepfake model               → ⚠ Likely AI / Uncertain / Likely real  (+ % confidence)
```

This means most cheap, definitive cases are answered locally and instantly, and the costly multimodal model is reserved for the genuinely ambiguous posts.

The result panel surfaces three clearly distinct trust levels:

1. **✓ Confirmed AI — C2PA Content Credentials** (verifiable provenance, local)
2. **✓ Confirmed AI — SynthID watermark** (verifiable provenance, backend)
3. **⚠ Model assessment** (probabilistic, with a confidence percentage)

---

## Provenance‑first design

Verilens treats *verifiable provenance* as stronger evidence than any probabilistic model, and splits the work by where it can correctly run:

**Stage A — local C2PA ([`lib/provenanceLocal.js`](lib/provenanceLocal.js))**
C2PA / Content Credentials is an open, signed‑metadata standard, so it can be parsed entirely in the browser with no model and no API key. Verilens reads the image bytes, detects the manifest, and confirms AI only when the manifest *declares* AI generation — a credentialed real photograph is never misreported.

**Stage B — backend SynthID**
SynthID detection is a hosted, keyed service; the extension never attempts to compute it. The backend returns it as one signal (`provenance.synthid`) that the extension simply consumes.

**Correctness rule.** Provenance *present* → high‑confidence AI. Provenance *absent* → **inconclusive**, route to the model. Absence is never presented as "authentic."

---

## Tiers

Gating lives in a single source of truth: [`lib/tiers.js`](lib/tiers.js).

| Feature | Free | Premium |
|---|:---:|:---:|
| Image deepfake detection | ✅ | ✅ |
| Video & audio deepfake detection | — | ✅ |
| Fact‑check | — | ✅ |
| Automatic content filtering | — | ✅ |

The service worker is the authoritative gatekeeper — it short‑circuits gated requests before any backend call. The UI's lock icons are cosmetic hints. Upgrade is handled through the in‑extension purchase flow and the marketing site.

---

## Supported platforms

- **X / Twitter**
- **Instagram**
- **Facebook**

All platform‑specific DOM logic is isolated in per‑site adapters under [`content/adapters/`](content/adapters/), each exposing the same interface (`findPosts`, `extractPostData`, `getActionAnchor`) and anchoring on stable, semantic selectors. The rest of the extension is platform‑agnostic.

---

## Installation

> Requires Google Chrome or any Chromium‑based browser with Manifest V3 support.

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top‑right).
4. Click **Load unpacked** and select the repository folder.
5. Open a supported site (e.g. `https://x.com`) and refresh the tab.

> Chrome injects content scripts on page load — if a tab was already open, refresh it. After editing any extension file, click **↻ Reload** on the Verilens card and refresh the tab.

Out of the box, Verilens runs against a built‑in mock backend, so every feature is fully functional with **zero configuration**. To use the real models, see [Connecting the real AI models](#connecting-the-real-ai-models).

---

## Usage

- **Check media** — click on any post with an image, video, or audio to run deepfake detection. Results appear in a panel attached to the post, with a colored band, confidence, and explanation.
- **Fact‑check** — click on a post with claims to get claim‑level verdicts and cited sources.
- **AI text detection** — select text on the page to assess whether it was AI‑generated.
- **Automatic filtering** — enable it from the popup (Premium). Flagged posts are blurred in place with a category label and a *Show anyway* button.
- **Popup** — master controls, category toggles, session stats, account/plan, and a link to the live dashboard.

Verdict bands: 🟢 likely real · 🟡 uncertain · 🔴 likely AI. Confirmed‑AI verdicts (C2PA / SynthID) are shown as verifiable, not probabilistic.

---

## Connecting the real AI models

Without configuration, Verilens uses the mock backend. To connect the hosted models — **VideoVeritas** (video), **FSD** (image), and **Fast‑DetectGPT** (text):

1. **Add your config (gitignored):**
   ```sh
   cp lib/config.local.example.js lib/config.local.js
   ```
   `lib/config.local.js` is the only place backend URLs live — there are no URL fields in the UI.

2. **Serve the models.** Run the notebooks in [`notebooks/`](notebooks/) on Kaggle; each prints a public ngrok URL:
   - [`videoveritas-ai-video-detection.ipynb`](notebooks/videoveritas-ai-video-detection.ipynb) — video deepfake model
   - [`fsd-image-detector.ipynb`](notebooks/fsd-image-detector.ipynb) — image deepfake model
   - [`fast-gpt.ipynb`](notebooks/fast-gpt.ipynb) — AI text detection model

3. **Paste the URLs** into `lib/config.local.js`:
   ```js
   g.VerilensConfig = {
     videoBackendUrl: "https://xxxx.ngrok-free.app",
     imageBackendUrl: "https://yyyy.ngrok-free.app",
     textBackendUrl:  "https://zzzz.ngrok-free.app",
   };
   ```
   Leave any value as `""` to keep using the mock for that modality.

4. **Reload** the extension and refresh the social tab.

If a configured backend is unreachable or its URL is empty, Verilens silently falls back to the mock — a result is always returned.

> **Running notebooks simultaneously (ngrok):** ngrok's free plan gives one static domain per **account**. To run several tunnels at once, use a separate ngrok account/authtoken per notebook, supplied via Kaggle Secrets (`NGROK_AUTH_TOKEN_VIDEO`, `NGROK_AUTH_TOKEN_IMAGE`, `NGROK_AUTH_TOKEN_TEXT`, each falling back to `NGROK_AUTH_TOKEN`). Reusing the same token under different secret names does not resolve the conflict.

---

## Marketing site & live `/docs`

The [`website/`](website/) folder is a **standalone static site** (plain HTML/CSS/JS, no build step) — it is *not* part of the extension bundle. It contains the marketing landing page, the purchase/upgrade flow, and a self‑contained **`/docs`** module that serves as pitch deck, technical whitepaper, and live system dashboard in one.

Run it locally from the repository root (so `/docs` can read the real `manifest.json`):

```sh
python3 -m http.server 8000      # or: ./serve.sh
```

| Page | URL |
|------|-----|
| Marketing landing | `http://localhost:8000/website/index.html` |
| Live `/docs` | `http://localhost:8000/website/docs/index.html` |
| `/docs` admin | `http://localhost:8000/website/docs/admin.html` |

**`/docs` highlights:** a YC‑style pitch deck, a technical whitepaper with architecture diagrams (Mermaid), API docs and a feature matrix, and a **live dashboard** that reads the real `manifest.json` at runtime and pings the live APIs for up/down status. It includes a grouped sidebar with scrollspy, global search, PDF/Markdown/link export, light & dark themes, and a responsive layout.

**Admin panel** ([`website/docs/admin.html`](website/docs/admin.html)) lets an editor manage every section, the team roster (with auto‑resized avatars), visibility scheduling, and version history, then export the canonical content back to [`website/docs/content.js`](website/docs/content.js). Access gating is showcase‑grade (client‑side), suitable for a static host preview window — not a security boundary.

---

## Architecture

```
┌──────────────┐     messages      ┌────────────────────┐     fetch / local      ┌──────────────────┐
│ content/*    │ ───────────────►  │ service-worker.js  │ ───────────────────►   │ provenance (local)│
│ (per-page UI)│                   │ router · tier gate │                        │ + AI backends     │
│ Shadow DOM   │ ◄───────────────  │ cache · provenance │ ◄───────────────────   │ (mock or real)    │
└──────────────┘     verdicts      └────────────────────┘     results            └──────────────────┘
```

**Manifest V3 principles the codebase follows:**

- **Service worker, not a background page** — no durable state in globals; everything persistent lives in `chrome.storage.local`.
- **No remotely‑hosted code** — all logic ships in the extension; AI lives behind `fetch`.
- **Least privilege** — only the permissions and host origins required by supported platforms; never `<all_urls>`.
- **Shadow DOM for all injected UI** — site CSS and Verilens CSS stay fully isolated.
- **Vanilla JS/CSS in the page** — no framework injected into the host site.
- **No bundler** — `lib/*` modules attach to `globalThis` via IIFEs and are shared verbatim by the service worker (`importScripts`) and content scripts (manifest), keeping shared logic a single source of truth with zero tooling.

---

## Project structure

```
.
├── manifest.json              # MV3 configuration
├── service-worker.js          # Message router · tier enforcement · cache · provenance · backend calls
├── lib/
│   ├── tiers.js               # Tier rules — single source of truth for gating
│   ├── hash.js                # Stable contentHash for cache identity
│   ├── cache.js               # Local LRU verdict mirror (chrome.storage.local)
│   ├── provenanceLocal.js     # Stage A — local C2PA parsing
│   ├── provenanceLocalMock.js # Deterministic C2PA stub for demos
│   ├── mockBackend.js         # Deterministic mock for all capabilities
│   ├── realBackend.js         # Real image/video model client
│   ├── realTextBackend.js     # Real AI-text-detection client
│   ├── config.js              # Backend config loader (+ config.local.js override)
│   └── config.local.example.js
├── content/
│   ├── content.js             # Entry point — finds posts, attaches controls (per-platform dispatch)
│   ├── actions.js             # Per-post Shadow DOM controls (Check media / Fact-check)
│   ├── badge.js               # Result + provenance + upgrade rendering
│   ├── filter.js              # Viewport-driven auto-filter (IntersectionObserver)
│   ├── textSelection.js       # AI text-detection on selection
│   ├── videoCapture.js        # Video frame capture for video deepfake
│   ├── videoFrameExtractor.js
│   ├── imageHover.js          # Hover affordance for media
│   ├── purchaseUnlock.js      # In-extension upgrade flow
│   ├── styles.css             # Shadow-DOM-scoped styles
│   └── adapters/              # twitter.js · instagram.js · facebook.js
├── popup/                     # popup.html / popup.js / popup.css
├── notebooks/                 # Kaggle model servers (video / image / text)
├── website/                   # Standalone marketing site + live /docs module
└── assets/                    # Icons & static assets
```

---

## Integration contracts

The extension is built against fixed request/response shapes, so swapping the mock for a real backend changes only the transport inside the service worker.

**Requests**

```jsonc
// deepfake / factcheck
{ "postId": "…", "postUrl": "…", "contentHash": "…",
  "imageUrls": ["…"], "captionText": "…", "hasVideo": false, "hasAudio": false }

// classify (batched, cheap path used by auto-filter)
{ "posts": [ { "postId": "…", "contentHash": "…", "captionText": "…", "imageUrls": ["…"] } ] }
```

**Deepfake result**

```jsonc
{
  "postId": "…",
  "cached": true,
  "media": {
    "image": { "aiGenerated": 0.0, "verdict": "likely_real|uncertain|likely_ai" },
    "video": { "available": false, "reason": "premium_required" },
    "audio": { "available": false, "reason": "premium_required" }
  },
  "confirmed": "c2pa | synthid | null",     // set when verifiable provenance proves AI
  "provenance": {
    "c2pa": "present | absent",             // resolved locally (Stage A)
    "synthid": "present | absent | uncertain", // supplied by the backend (Stage B)
    "source": "Adobe Firefly | null"
  },
  "band": "green|amber|red",
  "explanation": "Plain-English, 2-3 sentences."
}
```

**Fact‑check result**

```jsonc
{
  "postId": "…",
  "cached": false,
  "claims": [
    { "claim": "…", "verdict": "corroborated|contradicted|unverifiable|developing",
      "confidence": 0.0,
      "sources": [ { "outlet": "Reuters", "url": "…", "summary": "…" } ] }
  ],
  "overall": "mostly_true|mixed|mostly_false|unverifiable",
  "explanation": "Plain-English summary."
}
```

**Classify result** (auto‑filter)

```jsonc
{ "results": [ { "postId": "…",
    "labels": ["political","ai_media","sensitive","misinformation"],
    "confidence": 0.0 } ] }
```

**Gated response** (free user hits a premium feature; backend is never called)

```jsonc
{ "gated": true, "feature": "factCheck", "message": "Upgrade to Premium to use it." }
```

---

## Engineering notes

- **Caching.** Each scan sends a stable identity (`postId`, `postUrl`, `contentHash`). The extension keeps a small LRU mirror ([`lib/cache.js`](lib/cache.js)) keyed by `kind:postId` so badges reappear instantly and survive service‑worker restarts; the backend remains the source of truth. The worker holds the cache in memory and flushes to storage on a debounce to keep the UI responsive.
- **Performance.** The auto‑filter is viewport‑driven (`IntersectionObserver`): a post is classified once as it scrolls into view, then cached — no repeated full‑feed scans.
- **Resilience.** Content scripts detect an invalidated extension context (after a reload) and disconnect cleanly instead of throwing.
- **Debugging.** Content‑script logs appear in the page DevTools console; service‑worker logs at `chrome://extensions → Verilens → service worker`.

---

## Contributing

- Keep the three capabilities **separate** — distinct costs, tiers, and UI; never one merged score or code path.
- Put **all** platform DOM logic in an adapter; anchor on stable, semantic selectors only (`[role]`, `[data-testid]`, `<img>`, `<time>`) — never obfuscated class names.
- The **service worker is the gatekeeper**; UI locks are cosmetic.
- Match the **integration contracts** exactly; change shapes in lockstep with the backend.
- No durable state in service‑worker globals — use `chrome.storage.local`.
- All injected UI lives in a **Shadow DOM**, styled by `content/styles.css`.
- Prefix globals, classes, and storage keys with `Verilens` / `verilens`.

---

## License

© 2026 Verilens. All rights reserved.
