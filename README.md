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
| **M3** | Auto-filter (premium): `MutationObserver` + cheap classify path + **blur-in-place + label + "Show anyway"** + popup category toggles. Classify results cached in the local mirror (`classify` kind). | ⏭ Next |
| **M4** | Popup polish: master toggle, tier dev-switch, session stats, upgrade/account screen | Planned |
| **M5** | Instagram adapter | Planned |

Filter categories (M3): `political`, `ai_meme`, `ai_generated`, `misinformation`.

---

### Design tokens

- Bands: green `#2ecc71`, amber `#f39c12`, red `#e74c3c`, grey `#8b98a5` (unverifiable).
- Dark-mode-friendly, minimal, launch-quality. Premium-gated controls show a lock + upgrade CTA.
