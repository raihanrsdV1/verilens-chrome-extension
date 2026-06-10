# Verilens

**Verilens** is a Manifest V3 Chrome extension that helps people spot **deepfakes** and **misinformation** directly in their social feeds.

This repository is the **extension (frontend) + a mock backend**. The real AI pipeline (multimodal deepfake detection, agentic fact-checking, content classification) is a **separately hosted backend** built by our backend team. Everything here is built so that the day the real backend is ready, we swap the mock `fetch` calls for real ones and **nothing in the UI changes** — the request/response contracts are fixed (see [Backend contracts](#backend-contracts)).

> Status: **M1 + M2 complete** (manual image deepfake check, manual fact-check, tier gating, upgrade prompts, local cache mirror). See [Roadmap](#roadmap).

---

## Table of contents

- [Product model — three separate capabilities](#product-model--three-separate-capabilities)
- [Tiers & paywall](#tiers--paywall)
- [Architecture](#architecture)
- [How it works (request flow)](#how-it-works-request-flow)
- [Backend contracts](#backend-contracts)
- [The mock backend](#the-mock-backend)
- [Caching](#caching)
- [No build step — how modules are shared](#no-build-step--how-modules-are-shared)
- [Getting started (load & test)](#getting-started-load--test)
- [Configuring real AI backends (optional)](#configuring-real-ai-backends-optional)
- [Dev tips & debugging](#dev-tips--debugging)
- [Conventions for contributors](#conventions-for-contributors)
- [Roadmap](#roadmap)

---

## Product model — three separate capabilities

Verilens has **three distinct capabilities**. They are separate features with separate costs, separate UI, and separate tiers. **Do not merge them into a single "score."**

| # | Capability | Trigger | Cost / path | Tier |
|---|------------|---------|-------------|------|
| 1 | **Deepfake detection** | Manual — user clicks **"Check media"** on a specific post | Full multimodal pipeline | Image = **Free**; Video + Audio = **Premium** |
| 2 | **Fact-check** | Manual — user clicks **"Fact-check"** | Agentic verifier (agent + search) | **Premium** |
| 3 | **Content filtering** | **Automatic** — scans posts as they appear | **Cheap** lightweight classifier (NOT the full pipeline) | **Premium** |

Key rules:

- **Nothing runs the expensive pipeline automatically.** Deepfake and fact-check are always user-triggered. Running them on every feed post would be cost-prohibitive.
- **Content filtering is the only automatic feature**, and because it runs on every post it **must** use the cheap classify path — never the deepfake or fact-check pipeline.
- Deepfake and fact-check results are shown as **separate sections** in the result panel — never a single merged number.
- A free user who taps a premium feature sees an **upgrade prompt**, never a silent failure.

---

## Tiers & paywall

All gating lives in a **single source of truth**: [`lib/tiers.js`](lib/tiers.js).

```js
export const TIER_RULES = {
  free: {
    deepfakeImage: true,
    deepfakeVideo: false,
    deepfakeAudio: false,
    factCheck:     false,
    autoFilter:    false,
  },
  premium: {
    deepfakeImage: true,
    deepfakeVideo: true,
    deepfakeAudio: true,
    factCheck:     true,
    autoFilter:    true,
  },
};
// isAllowed("factCheck", "free") -> false
```

To change what's gated, edit **only** this file. The service worker is the authoritative gatekeeper (it short-circuits gated requests before calling the backend); the UI also reads tier rules to show locks, but never to *enforce* the gate.

The current tier is stored in `chrome.storage.local` under `verilens_tier` (defaults to `"free"`). A proper in-popup tier dev-switch arrives in M4; until then, flip it from the **service worker console** (see [Dev tips](#dev-tips--debugging)).

---

## Architecture

```
verilens/
├── manifest.json              # MV3 config: permissions, content scripts, host matches
├── service-worker.js          # "Brain": message router, tier enforcement, cache, calls backend (mock)
├── lib/
│   ├── tiers.js               # TIER_RULES + isAllowed() — single source of truth for gating
│   ├── hash.js                # Stable contentHash (FNV-1a) from image URLs + caption
│   ├── cache.js               # Local LRU mirror over chrome.storage.local, keyed by kind:postId
│   └── mockBackend.js         # Deterministic fake responses for all three capabilities
└── content/
    ├── adapters/
    │   └── twitter.js         # ALL X/Twitter DOM knowledge (findPosts, extractPostData, anchor)
    ├── content.js             # Entry point: finds posts, attaches per-post controls
    ├── actions.js             # Per-post Shadow DOM host + "Check media" / "Fact-check" buttons
    ├── badge.js               # Renders deepfake + fact-check result panels + upgrade card
    └── styles.css             # Scoped styles (loaded INSIDE the Shadow DOM)
```

### Hard MV3 rules we follow

- **Service worker, not a background page.** It terminates when idle, so we keep **zero durable state in globals** — everything persistent lives in `chrome.storage.local`.
- **No remotely-hosted code.** All JS ships in the extension; the AI lives on the backend and is reached via `fetch`.
- **Minimal permissions.** Only `storage` + host permissions for our target platforms (`x.com`, `twitter.com`) — never `<all_urls>`.
- **Shadow DOM for all injected UI**, so the site's CSS and ours stay isolated.
- **Vanilla JS + CSS** in the content script — no framework injected into the page.
- The auto-filter (M3) uses a `MutationObserver`. Manual scans are click-triggered. (Note: M1/M2 also use a `MutationObserver`, but **only to attach buttons** — it performs no network calls and runs no classifier.)

### Platform adapters

Each platform gets one module under `content/adapters/`. All DOM knowledge for that site lives there, so the rest of the extension is platform-agnostic. Every adapter exports:

```js
findPosts()                  // -> Array<postEl>
extractPostData(postEl)      // -> { postId, postUrl, contentHash, imageUrls, captionText, hasVideo, hasAudio }
getActionAnchor(postEl)      // -> { parent, before }  where to attach our UI
```

Adapters anchor on **stable** selectors only: `[role=...]`, `[data-testid=...]`, `<img>`, `aria-label`, `<time>` permalinks. **Never** obfuscated CSS class names.

---

## How it works (request flow)

1. **content.js** observes the feed and, for each new post with analyzable media, calls **actions.js** to attach a quiet **🛡 Verilens** control bar (Shadow DOM).
2. User clicks **"Check media"** or **"Fact-check"**.
3. **actions.js** computes the post data (via the adapter, including a stable `contentHash`) and sends a message to the **service worker**.
4. The **service worker**:
   - enforces the **tier gate** (gated → returns an upgrade prompt, never calls the backend);
   - checks the **local cache mirror** (hit → returns instantly with `cached: true`);
   - on a miss, calls the **backend** (currently `mockBackend.js`), then writes the result to the mirror.
5. **badge.js** renders the result into the post's Shadow DOM panel — deepfake and fact-check in separate sections.

---

## Backend contracts

Build all UI against these exact shapes. When the real backend is ready, only the transport inside the service worker changes.

### Requests

```jsonc
// POST /deepfake   and   POST /factcheck
{ "postId": "...", "postUrl": "...", "contentHash": "...",
  "imageUrls": ["..."], "captionText": "...", "hasVideo": false, "hasAudio": false }

// POST /classify  (batched, cheap path, used by the auto-filter)
{ "posts": [ { "postId": "...", "contentHash": "...", "captionText": "...", "imageUrls": ["..."] } ] }
```

### Deepfake result

```jsonc
{
  "postId": "...",
  "cached": true,
  "media": {
    "image": { "aiGenerated": 0.0, "verdict": "likely_real|uncertain|likely_ai" },
    "video": { "available": false, "reason": "premium_required" },
    "audio": { "available": false, "reason": "premium_required" }
  },
  // Provenance. `confirmed` is set when verifiable provenance proves AI; the
  // backend supplies provenance.synthid (the extension never computes it). C2PA
  // is resolved locally in Stage A and short-circuits before the backend.
  "confirmed": "c2pa | synthid | null",
  "provenance": {
    "c2pa": "present | absent",
    "synthid": "present | absent | uncertain",
    "source": "Adobe Firefly | null"
  },
  "band": "green|amber|red",
  "explanation": "Plain-English, 2-3 sentences."
}
```

### Fact-check result

```jsonc
{
  "postId": "...",
  "cached": false,
  "claims": [
    { "claim": "...", "verdict": "corroborated|contradicted|unverifiable|developing",
      "confidence": 0.0,
      "sources": [ { "outlet": "Reuters", "url": "...", "summary": "..." } ] }
  ],
  "overall": "mostly_true|mixed|mostly_false|unverifiable",
  "explanation": "Plain-English summary."
}
```

A free user hitting a gated feature instead receives a short-circuit response from the worker:

```jsonc
{ "gated": true, "feature": "factCheck", "message": "Upgrade to Premium to use it." }
```

### Classify result (auto-filter, cheap path — used in M3)

```jsonc
{ "results": [ { "postId": "...",
    "labels": ["political","ai_meme","ai_generated","misinformation"],
    "confidence": 0.0 } ] }
```

---

## The mock backend

[`lib/mockBackend.js`](lib/mockBackend.js) lets us build the whole extension before the real AI exists.

- **Deterministic from `contentHash`** — the same post always returns the same verdict, so the UI is predictable while developing.
- **Respects tiers** — e.g. on the free tier, video/audio come back `{ available: false, reason: "premium_required" }`.
- **Latency & cache flag are owned by the worker, not the mock.** The worker only calls the mock on a cache **miss**, and adds the artificial 400–900ms (deepfake) / 500–1200ms (fact-check) delay there — exactly how the real backend split will behave, so loading states are real.

Swapping in the real backend = replace the `Mock.deepfake(...)` / `Mock.factcheck(...)` calls in `service-worker.js` with `fetch()` calls to the contract endpoints. The cache, gating, and UI are untouched.

---

## Provenance pre-check (two-stage, split by where it can run)

Before the probabilistic deepfake pipeline runs, we check for **verifiable provenance**. The split is dictated by runtime reality:

### Stage A — LOCAL (in the extension), [`lib/provenanceLocal.js`](lib/provenanceLocal.js)
- Parses **C2PA / Content Credentials** — an open, *signed-metadata* standard. This needs only a parser (no ML model, no key, no remote code), so it runs locally and instantly.
- Wired in the **service worker before the backend call**. A signed credential declaring AI → **instant "Confirmed AI"**, no backend request.
- Mock: [`lib/provenanceLocalMock.js`](lib/provenanceLocalMock.js) (~20% return `present`, `<50ms`). **TODO(real):** drop in the in-browser `c2pa` JS SDK (needs image bytes → add a host permission for the image origin).

### Stage B — BACKEND, **SynthID**
- **There is no local SynthID detector** — SynthID image detection is Google/OpenAI's hosted, keyed service. The extension **never computes it**. The backend runs it as one pipeline signal and returns it as `provenance.synthid`.

### Correctness rule (critical)
- Provenance **present** (C2PA local *or* SynthID backend) → **high-confidence AI**.
- Provenance **absent** → **inconclusive**, fall through to the model. **Never** render absence as "real"/green — the UI only shows the model's own verdict in that case.

The deepfake verdict therefore carries two extra fields (see below): `confirmed` and `provenance`.

---

## Caching

The **backend owns the real cache** (source of truth) and dedupes so the pipeline never re-runs on an already-verified post. With every request the extension sends a stable identifier:

- **`postUrl`** — canonical permalink (each adapter extracts this).
- **`postId`** — platform-native ID parsed from the URL/DOM.
- **`contentHash`** — hash of (image src(s) + caption) as a fallback identifier and to catch the same content reposted under a different URL.

The extension also keeps a **small local mirror** ([`lib/cache.js`](lib/cache.js)) in `chrome.storage.local`, keyed by `kind:postId` (so a post's deepfake and fact-check verdicts cache independently). It's a **convenience cache only** — capped with **LRU eviction** (max 200 entries); the backend remains authoritative. It makes a badge reappear instantly for posts you already scanned, and survives service-worker restarts.

---

## No build step — how modules are shared

We intentionally have **no bundler** (keeps the project approachable; nothing to install). The `lib/*.js` files are shared between the **service worker** and the **content scripts** like this:

- Each lib file uses an IIFE that attaches to `globalThis`, with **no `import`/`export`**:
  ```js
  (function (g) {
    /* ... */
    g.VerilensThing = { /* exports */ };
  })(globalThis);
  ```
- The **service worker** is a *classic* worker and loads them via `importScripts("lib/...")`.
- The **content scripts** load the same files via the manifest `content_scripts.js` array, in dependency order.
- `globalThis` is `self` in the worker and `window` (isolated world) in content scripts, so one file works in both.

This keeps `tiers.js` / `hash.js` a true single source of truth with zero tooling.

---

## Getting started (load & test)

> Requires Google Chrome (or any Chromium browser with MV3 support).

1. **Clone** this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** ON (top-right).
4. Click **Load unpacked** and select the repo folder.
5. The **Verilens** card should appear with no errors. (If there's a red **Errors** button, open it.)
6. Go to **https://x.com**, log in, and **hard-refresh** the tab (`Cmd/Ctrl+Shift+R`).
   > Chrome only injects content scripts on page load — if the tab was already open, you must refresh it.
7. Scroll to any post **with an image**. You'll see a quiet **🛡 Verilens · [Check media] [🔒 Fact-check]** bar.

### Test the deepfake check (free)
- Click **Check media** → ~0.5s loading → a panel with a colored band (🟢/🟡/🔴), an "X% AI" figure, and an explanation.
- Click again / scroll away and back → returns instantly with a **cached** chip.

### Test the fact-check gate (premium)
- As a **free** user, click **🔒 Fact-check** → an upgrade card appears (the backend is **not** called).
- Click **Enable premium (dev)** on that card → flips your tier, drops the lock, and re-runs the fact-check with claim-level verdicts + sources.
- Both deepfake and fact-check sections can show on the same post at once.

### After editing any file
Click the **↻ reload** icon on the Verilens card, then **hard-refresh** the x.com tab.

---

## Configuring real AI backends (optional)

Without any configuration, Verilens runs entirely on the **mock backend** —
deterministic fake results, no setup required.

To connect the real hosted models (VideoVeritas for video, FSD for images):

1. Copy the example config:
   ```sh
   cp lib/config.local.example.js lib/config.local.js
   ```
   `lib/config.local.js` is **gitignored** — it's the only place backend URLs
   live. There are **no URL fields in the popup**.
2. Run the model notebooks on Kaggle:
   - [`videoveritas-ai-video-detection.ipynb`](videoveritas-ai-video-detection.ipynb) — serves the video deepfake model and prints an ngrok URL.
   - [`fsd-image-detector.ipynb`](fsd-image-detector.ipynb) — serves the image deepfake model and prints an ngrok URL.
3. Paste the printed URLs into `lib/config.local.js`:
   ```js
   g.VerilensConfig = {
     videoBackendUrl: "https://xxxx.ngrok-free.app", // from videoveritas-ai-video-detection.ipynb
     imageBackendUrl: "https://yyyy.ngrok-free.app", // from fsd-image-detector.ipynb
   };
   ```
   Leave a value as `""` to keep using the mock for that modality.
4. Reload the extension at `chrome://extensions` and hard-refresh the social tab.

If a configured backend is unreachable (or the URL is empty), Verilens
silently falls back to the mock — "Check media" always returns a result.

### Running both notebooks at the same time (ngrok)

ngrok's free plan gives each **account** one shared static domain. If both
notebooks authenticate with the **same** authtoken, the second tunnel fails
with `ERR_NGROK_334` ("endpoint ... is already online").

To run both simultaneously, use a **separate free ngrok account + authtoken**
per notebook, added as Kaggle Secrets:
- `videoveritas-ai-video-detection.ipynb` reads `NGROK_AUTH_TOKEN_VIDEO`
  (falls back to `NGROK_AUTH_TOKEN`).
- `fsd-image-detector.ipynb` reads `NGROK_AUTH_TOKEN_IMAGE` (falls back to
  `NGROK_AUTH_TOKEN`).

Just renaming/duplicating the same token under both secret names does **not**
fix the conflict — the token has to come from a genuinely different ngrok
account.

---

## Dev tips & debugging

- **Content-script logs/errors:** open DevTools on the x.com tab → Console.
- **Service-worker logs/errors:** `chrome://extensions` → Verilens → click the **"service worker"** link.
- **Which console am I in?** Type `chrome.storage` and press Enter:
  - Worker console → a `StorageArea` object ✅
  - Page console → `undefined` ❌ (the page runs in the main world; our content-script globals and `chrome.storage` aren't there).
- **Flip your tier** (until the M4 popup switch exists) — run in the **service worker** console:
  ```js
  chrome.storage.local.set({ verilens_tier: "premium" }) // or "free"
  ```
  Then hard-refresh the x.com tab.
- **Inspect the cache mirror:**
  ```js
  chrome.storage.local.get("verilens_cache").then(console.log)
  ```

---

## Conventions for contributors

- **Keep the three capabilities separate.** Don't fold deepfake, fact-check, and content-filter into one score or one code path. Different costs, different tiers, different UI.
- **All platform DOM logic goes in an adapter.** Don't query site-specific selectors anywhere else.
- **Anchor on stable selectors only** (`[role]`, `[data-testid]`, `<img>`, `<time>`). Never obfuscated class names.
- **The service worker is the gatekeeper.** Enforce tier rules there; the UI's locks are cosmetic hints.
- **Match the backend contracts exactly.** If a shape needs to change, change it in lockstep with the backend team.
- **No durable state in service-worker globals** — use `chrome.storage.local`.
- **All injected UI lives in a Shadow DOM**, styled by `content/styles.css`.
- **Naming:** globals/classes/storage keys are prefixed `Verilens` / `verilens`.

---

## Roadmap

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M1** | manifest + service worker + Twitter/X adapter + "Check media" deepfake button (image) + result panel + local cache mirror | ✅ Done |
| **M2** | Fact-check button + result panel + tier gating + upgrade prompts | ✅ Done |
| **M3** | Auto-filter (premium): viewport-driven `IntersectionObserver` + cheap classify path (+ local C2PA signal) + **blur-in-place + label + "Show anyway"** + popup category toggles. Classify results cached in the local mirror (`classify` kind). | ✅ Done |
| **M4** | Popup polish: master toggle, session stats, upgrade screen, collapsed Developer tools (tier dev-switch) | ✅ Done |
| **M5** | Instagram adapter + Facebook adapter; multi-platform dispatch by hostname | ✅ Done |

Filter categories: `political`, `ai_meme`, `ai_generated`, `misinformation`.

**Supported platforms:** X/Twitter (mature), Instagram & Facebook (best-effort selectors — their DOM is heavily obfuscated and may need retuning in the adapter files).

---

## Known issues & remaining work

Captured for follow-up. X/Twitter is solid; the newer adapters and some surfaces need more work.

### Facebook adapter — not reliably working
- The Verilens control bar often does **not** appear on Facebook posts. FB's DOM is fully obfuscated and varies by account/rollout (classic vs. newer layouts), so the current selectors in [`content/adapters/facebook.js`](content/adapters/facebook.js) need tuning against live markup.
- Likely culprits to investigate: `findPosts()` (`[role="article"]` may not match every post container or may match too much), `getActionAnchor()` (the like/comment toolbar isn't a reliable `[role="group"]`), and caption/image extraction.
- **TODO:** instrument with the console diagnostic (post count vs. `.verilens-host` count), then retune `findPosts` / anchor / caption / image selectors. Consider scoping to the main feed container.

### Instagram & Facebook Reels / video-first surfaces — need a new button UI
- **Reels** (IG) and **Reels/Watch** (FB) use a full-screen, vertical, overlay-heavy layout that's very different from feed posts. The current approach — injecting an inline control bar near a post's action row — **doesn't fit** there (no stable inline anchor; our bar gets hidden or mispositioned).
- This isn't just a selector fix; it needs a **different control representation** for video-first surfaces. Options to design:
  - A small **floating action button** (FAB) pinned to the viewport that targets the currently-visible reel.
  - Attaching to the reel's **right-hand action rail** (like/comment/share stack) as an extra item.
  - A single toolbar/badge anchored to the reel container rather than an inline bar.
- **TODO:** design + implement a reel/video control mode, separate from the feed-post inline bar, and have the adapter report whether a surface is "feed" vs "reel" so `actions.js` can pick the right UI.

### C2PA provenance
- Stage A C2PA parsing is **real** (reads image bytes, detects manifest + AI marker) but does **not verify the cryptographic signature** — that needs the official in-browser `c2pa` **WASM SDK** (vendored wasm/worker assets). Marked `TODO(verify)` in [`lib/provenanceLocal.js`](lib/provenanceLocal.js).
- Reality check: X/Twitter (and most platforms) **strip C2PA on upload**, so real-mode C2PA reads "absent" on nearly all real posts. Flip `MODE = "mock"` in `provenanceLocal.js` to demo the Confirmed-AI-via-C2PA UI.

### Backend
- All three capabilities still run against the **mock backend** (`lib/mockBackend.js`). Swapping in the real hosted pipeline = replace the `Mock.*` calls in `service-worker.js` with `fetch()` to the documented contract endpoints. SynthID is a backend signal the extension only consumes.

### Smaller items
- IG/FB image extraction excludes avatars heuristically; may occasionally miss or over-match content images.
- Real-mode C2PA on the auto-filter path fetches image bytes per visible post — watch for scroll cost on slow connections; consider restricting real C2PA to the manual click path if needed.

---

### Design tokens

- Bands: green `#2ecc71`, amber `#f39c12`, red `#e74c3c`, grey `#8b98a5` (unverifiable).
- Dark-mode-friendly, minimal, launch-quality. Premium-gated controls show a lock + upgrade CTA.
