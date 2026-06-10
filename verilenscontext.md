# Verilens — Engineering Context (Claude's working notes)

> Personal context file. Captures everything about this project so I never need to
> re-read the whole codebase. Update this when the architecture changes.

## What it is
**Verilens** — a Manifest V3 Chrome extension that flags **deepfakes** and
**misinformation** directly inside social feeds (X/Twitter, Instagram, Facebook).
Frontend (extension) + a **mock backend** baked into the extension. The real AI
pipeline is meant to be a separately-hosted backend; the extension talks to it
via fixed request/response contracts so the UI never changes when mock → real.

No build step, no bundler, no framework. Vanilla JS + CSS. Lib files use an
IIFE-attach-to-`globalThis` pattern (no import/export) so the SAME file loads in
both the service worker (`importScripts`) and content scripts (manifest array).
`globalThis` = `self` in the worker, `window` (isolated world) in content scripts.

## Three SEPARATE capabilities (never merge into one score)
| # | Capability | Trigger | Cost | Tier |
|---|-----------|---------|------|------|
| 1 | Deepfake detection | manual "Check media" | full multimodal | image = Free; **video+audio = Premium** |
| 2 | Fact-check | manual "Fact-check" | agent + search | Premium |
| 3 | Content filtering | automatic on scroll | cheap classifier | Premium |
| 4 | AI text detection | select text → "Check AI" | classifier | Premium |

Plus a hover badge (imageHover.js) that runs the deepfake scan on hover over any
image/video.

## Config file (the ".env" for this extension)
- `lib/config.local.js` (gitignored) — sets `globalThis.VerilensConfig =
  {videoBackendUrl, imageBackendUrl}`. The ONLY place backend ngrok URLs live.
  Loaded FIRST in both `manifest.json`'s `content_scripts[0].js` and
  `service-worker.js`'s `importScripts`, so `lib/realBackend.js` and
  `content/actions.js` can read it synchronously off `globalThis`.
- `lib/config.local.example.js` (committed) — template with empty strings;
  copy to `lib/config.local.js` and fill in real ngrok URLs.
- The popup has **no URL input fields** — it only shows read-only connection
  status for whatever URLs are in `lib/config.local.js`.

## File map (all paths relative to repo root)
- `manifest.json` — MV3 config. permissions: `storage` only. host_permissions for
  x/twitter/pbs.twimg/instagram/cdninstagram/facebook/fbcdn. content_scripts inject
  `lib/config.local.js` FIRST, then the rest of the lib + content files (order
  matters — deps first). web_accessible: styles.css.
- `service-worker.js` — the "brain". Classic worker (importScripts, with
  `lib/config.local.js` first). Routes messages, enforces tier gate, checks local
  cache, calls mock backend (or real, see below), bumps session stats, seeds
  defaults onInstalled. Message types: `SCAN_DEEPFAKE`, `SCAN_FACTCHECK`,
  `DETECT_TEXT`, `CLASSIFY`, `GET_TIER`, `SET_TIER`. DEBUG=true logs to the SW console.
- `lib/tiers.js` — `VerilensTiers.TIER_RULES` + `isAllowed(feature, tier)`. SINGLE
  source of truth for gating. Features: deepfakeImage/Video/Audio, factCheck,
  autoFilter, detectText.
- `lib/hash.js` — `VerilensHash.contentHash(imageUrls, captionText)` (FNV-1a, stable,
  prefix `h_`) and `fnv1a(str)`.
- `lib/cache.js` — `VerilensCache` LRU mirror (max 200) over chrome.storage.local key
  `verilens_cache`, keyed `${kind}:${postId}`. In-memory map + debounced flush (800ms).
  kinds: deepfake / factcheck / classify / detectText. SW-only.
- `lib/mockBackend.js` — `VerilensMock` deterministic-from-contentHash fake responses:
  `deepfake(payload,tier)`, `factcheck(payload)`, `classify({posts})`,
  `detectText(payload)`. Pipeline order in deepfake: SynthID watermark first
  (present → confirmed AI, no model), else probabilistic band green/amber/red.
- `lib/provenanceLocal.js` — `VerilensProvenance.check(payload)` STAGE A local C2PA
  parse. MODE="real" fetches image head bytes, scans for c2pa manifest + AI markers;
  MODE="mock" delegates to provenanceLocalMock. Returns {found,standard,source,state}.
- `lib/provenanceLocalMock.js` — `VerilensProvenanceMock.check` ~20% "present".
- `content/content.js` — entry point. Picks adapter by hostname, MutationObserver
  ATTACHES BUTTONS ONLY (no network), inits VerilensFilter.
- `content/adapters/{twitter,instagram,facebook}.js` — ALL DOM knowledge. Each exports
  `findPosts()`, `extractPostData(postEl)`, `getActionAnchor(postEl)`.
  extractPostData → {postId, postUrl, contentHash, imageUrls, captionText, hasVideo,
  hasAudio, videoUrl (added)}.
- `content/actions.js` — `VerilensActions.attach`. Per-post Shadow DOM host + control
  bar (Check media / Fact-check buttons), gating locks, runDeepfake/runFactcheck.
- `content/badge.js` — `VerilensBadge.renderDeepfake/renderFactcheck/renderUpgrade`.
  Separate sections per kind. Deepfake shows confirmed-AI (c2pa/synthid) or model band
  + % AI + provenance note + explanation. Section titles include a modality suffix via
  `modalityLabel(result)` — "Deepfake check · Image" / "· Video" / "· Image + Video";
  Fact-check is always "Fact-check · Text". Gated upgrade card for deepfake is always
  "· Video" (image deepfake is free, never gated).
- `content/filter.js` — `VerilensFilter.init`. Auto content filter. IntersectionObserver
  classifies posts on view, blurs matches in place with "Show anyway". Premium + enabled.
- `content/textSelection.js` — floating "🛡 Check AI" button on text selection → DETECT_TEXT.
- `content/imageHover.js` — hover (400ms) over image/video → SCAN_DEEPFAKE → corner badge.
  `findMediaTarget` is platform-agnostic: direct `<img>`/`<video>` hit, or walks up to
  6 ancestors looking for one that contains a `<video>` (handles X/IG/FB overlay divs).
  Gated by `verilens_hover_detect_enabled` (checked on mouseover, live via
  storage.onChanged), **default false / OFF**.
- `content/videoCapture.js` (added) — `VerilensVideoCapture.{fromUrl, findVideoSrc, prepare,
  prepareThorough, captureFrames}`.
  - `prepare(videoUrl)` — QUICK (hover badge): only tries `fetch(blob:)` → `videoDataUrl`.
  - `prepareThorough(videoUrl, videoEl)` — "Check media" click. Attaches `videoMaxSeconds`
    (from `verilens_video_max_seconds`, 0 = full video), then gets pixels: if the blob:
    src is fetchable → `videoDataUrl`; otherwise (MSE blob:, the IG/X/FB norm) →
    `captureFrames(videoEl, maxSeconds)` → `videoFrames[]` (JPEG data URLs).
  - `captureFrames` — seeks the live `<video>` to evenly-spaced timestamps across the
    first `maxSeconds` (clamped to duration AND buffered range), draws each to a
    downscaled (≤480px) canvas, `toDataURL("image/jpeg",0.7)`. 4–16 frames. Restores
    the user's play/time/mute state after. WHY canvas works when fetch doesn't: MSE
    blob: URLs aren't fetchable files, but MSE video is treated as same-origin so
    canvas read-back is NOT tainted (unless DRM/EME → SecurityError → returns null →
    mock). Do NOT use `video.captureStream()`/`MediaRecorder` here — that crashed the
    renderer ("Aw, Snap!" / STATUS_BREAKPOINT) on these players.
- `lib/realBackend.js` (added) — `VerilensRealBackend.{getBackendUrl, getImageBackendUrl,
  ping, detectVideo, detectImage}`. Two real backends, both SW-only, both
  Kaggle+ngrok. `getBackendUrl`/`getImageBackendUrl` read
  `globalThis.VerilensConfig.{videoBackendUrl,imageBackendUrl}` (from
  `lib/config.local.js`) — no chrome.storage involved.
  - `detectVideo` → VideoVeritas (vLLM OpenAI API), uses `videoBackendUrl`. `ping`
    (GET /v1/models) is used internally to discover the served model id.
  - `detectImage` → FSD image forensics model (plain FastAPI), uses
    `imageBackendUrl`. Fetches `imageUrls[0]` in the worker (host-perm CORS
    bypass) → base64 → `POST /detect {image_b64}` → `{is_fake, score}`. Maps is_fake→
    red/likely_ai, else green/likely_real; uses `score` as the %-AI when present, else
    0.9/0.08.
- `popup/popup.{html,js,css}` — tabbed popup (⚙ Settings / ❓ Help). No backend
  status/connection UI at all — backend health is invisible to the user; failures
  silently fall back to the mock.
  - **Settings tab**: auto-filter toggle + categories (Premium-gated), "Detection
    settings" card (hover-scan toggle, default OFF + video analysis length select),
    session stats, upgrade/premium card, Developer (tier dev-switch + reset stats).
  - **Help tab**: plain-language cards explaining Check media + band legend,
    confirmed AI (C2PA/SynthID), Fact-check, Scan on hover, Video analysis length,
    Auto content filter, AI model backends, and a Free vs Premium plan grid.
  - Action buttons in posts use `.verilens-btn-primary` ("🔍 Check media", blue) and
    `.verilens-btn-secondary` ("📰 Fact-check", green) — see content/styles.css.

## Backend contracts (must match exactly)
- Deepfake req: `{postId, postUrl, contentHash, imageUrls[], captionText, hasVideo,
  hasAudio}` (+ added: `videoUrl`, `videoDataUrl` for real video detection).
- Deepfake res: `{postId, cached, media:{image,video,audio}, confirmed:"c2pa|synthid|null",
  provenance:{c2pa,synthid,source}, band:"green|amber|red", explanation}`. media.image =
  `{aiGenerated:0..1, verdict}` or `{available:false, reason}`. video/audio same shape.
- Fact-check res: `{postId, cached, claims:[{claim,verdict,confidence,sources[]}], overall,
  explanation}`.
- Classify res: `{results:[{postId, labels[], confidence, provenance?}]}`. labels:
  political/ai_meme/ai_generated/misinformation.
- detect-text res: `{textHash, cached, aiGenerated, band, verdict, explanation}`.
- Gated short-circuit: `{gated:true, feature, message}`.

## Storage keys (chrome.storage.local)
- `verilens_tier` "free"|"premium" (default free)
- `verilens_autofilter_enabled` bool (default false)
- `verilens_filter_categories` {political,ai_meme,ai_generated,misinformation}
- `verilens_stats` {deepfakeScans, factCheckScans, confirmedAI, filteredPosts, detectTextScans}
- `verilens_cache` LRU mirror
- `verilens_hover_detect_enabled` (added) bool, **default false** — master switch for
  the imageHover.js automatic hover-scan badge.

> Backend ngrok URLs are NOT in chrome.storage — see "Config file" above
> (`lib/config.local.js`).
- `verilens_video_max_seconds` (added) number, default 20 — how many seconds of video
  `prepareThorough` records for the real backend; 0 = "Full video" (120s safety cap).

## The notebook: videoveritas-ai-video-detection.ipynb
Kaggle T4 x2 notebook. Installs latest vLLM (Py3.12 wheels), removes flashinfer
(no sm_75/T4 kernel), uses xformers attention backend, `--enforce-eager`. Downloads
**EricTanh/VideoVeritas** (~17 GB, a Qwen3-VL-based video real-vs-AI model) from
ModelScope. Serves it via `vllm serve` as an **OpenAI-compatible API** on
`0.0.0.0:8000` (`/v1/models`, `/v1/chat/completions`). Inference: send a video as a
`video_url` with a `data:video/mp4;base64,...` URL + text prompt; model replies with
reasoning and a verdict inside `<answer>real</answer>` / `<answer>fake</answer>`.
Uses `extra_body.mm_processor_kwargs = {fps:2, max_pixels:360*420}` (top-level
`mm_processor_kwargs` in raw JSON). The server is localhost-only → needs **ngrok** to
be reachable from the extension.

### ngrok dual-account requirement (running both notebooks at once)
ngrok's free plan gives each ACCOUNT one shared static domain. If both notebooks
use the same authtoken, the second `ngrok.connect()` fails with `ERR_NGROK_334`
("endpoint ... is already online"). Fix: use a SEPARATE free ngrok account +
authtoken per notebook:
- `videoveritas-ai-video-detection.ipynb` → Kaggle Secret `NGROK_AUTH_TOKEN_VIDEO`
  (falls back to `NGROK_AUTH_TOKEN`).
- `fsd-image-detector.ipynb` → Kaggle Secret `NGROK_AUTH_TOKEN_IMAGE` (falls back to
  `NGROK_AUTH_TOKEN`).
Both ngrok cells now print "Paste that URL into `lib/config.local.js`" instead of
the old popup-field instructions.

## How the real VideoVeritas integration works (what I built)
1. Notebook: an added cell installs pyngrok and opens an HTTP tunnel to port 8000,
   printing the public `https://*.ngrok-*.app` URL.
2. User pastes that URL into `lib/config.local.js` → `videoBackendUrl`. The popup's
   "AI model backends" card pings it read-only via SW `PING_BACKEND` → GET /v1/models.
3. When a **premium** user clicks "Check media" on a post **with video** and a backend
   URL is set, `actions.runDeepfake(…, postEl)` calls
   `videoCapture.prepareThorough(videoUrl, postEl.querySelector("video"))` BEFORE
   sending SCAN_DEEPFAKE. Result attaches `videoMaxSeconds` plus EITHER `videoDataUrl`
   (fetchable) OR `videoFrames[]` (canvas frames off the MSE `<video>`). (The hover
   badge uses `prepare()` — blob: fetch only, no frames — and skips entirely if no
   backend URL is set.)
4. `service-worker.handleDeepfake` calls `RealBackend.detectVideo` BEFORE the mock when
   `payload.hasVideo` + premium + backend URL set. `detectVideo` picks the path:
   - `videoFrames[]` present → sends them as ordered `image_url` items + a "these are
     frames from one clip, judge the video" text prompt (this is the IG/X/FB path now).
   - else → resolves a single `video_url` data URL from `videoDataUrl` or by fetching
     `videoUrl` if https; `videoMaxSeconds>0` adds `mm_processor_kwargs.max_frames =
     round(videoMaxSeconds*2fps)`.
   Either way parses `<answer>`, maps fake→red/likely_ai (~0.9),
   real→green/likely_real (~0.08), else amber; shaped to the deepfake contract
   (media.video.aiGenerated/verdict) and cached.
5. If no backend / no pixels / request fails → **falls back to the mock** so demos still
   work. All requests send `ngrok-skip-browser-warning: true` to skip ngrok's interstitial.

## How the real FSD image integration works (what I built)
Mirrors the video path but simpler (no MSE problem — images are plain CDN URLs):
1. Notebook `fsd-image-detector.ipynb` clones the FSD repo, loads `FSDDetector`, and
   (added cells) serves it via a tiny FastAPI app (`/health`, `/detect`) on port 8000,
   tunneled with ngrok. Paste the URL into `lib/config.local.js` → `imageBackendUrl`.
2. `service-worker.handleDeepfake` runs the image real-detection block AFTER the
   video block and BEFORE the mock: when `hasImage` and `imageBackendUrl`
   is set, it calls `RealBackend.detectImage(payload)`. Image detection is FREE (no
   tier gate — `deepfakeImage` is a free feature). The worker fetches `imageUrls[0]`
   itself (host permissions cover pbs.twimg/cdninstagram/fbcdn), base64s it, and POSTs.
3. Precedence: video posts (`hasVideo` + premium + video URL) still go to VideoVeritas
   first; pure image posts go to FSD; any failure falls through to the mock.
4. `buildImageResult` shapes `{is_fake, score}` into the deepfake contract
   (media.image.aiGenerated/verdict, source "fsd"), then caches it.

### Remaining limitation (documented, expected)
Frame capture needs the `<video>` to be decodable in the DOM (metadata loaded,
buffered range covering the sampled window) and not DRM/EME-protected (Netflix-style
→ tainted canvas → null → mock). For IG/X/FB user videos this is fine. If the post's
video hasn't started/buffered when "Check media" is clicked, frames may be sparse —
the model still gets what's buffered. Do NOT "fix" capture with
`captureStream()`/`MediaRecorder` on the page `<video>` — it crashed the renderer on
MSE players; see content/videoCapture.js.

## The notebook: fsd-image-detector.ipynb
Kaggle GPU (T4/P100) notebook. Clones **Forensic-Self-Descriptions-CVPR25** (FSD,
CVPR'25), `uv pip install -e .`, then `FSDDetector.load(attribution=False)` +
`detector.score_batch([paths])` → each result has `.is_fake` (binary real-vs-AI).
~12s/image on a T4. Original notebook only EVALUATES; I added serving cells: a
FastAPI app (`/health` → `{ok,model}`, `/detect {image_b64}` → `{is_fake,score}`)
run in a daemon thread, exposed via ngrok on port 8000. The `score` field is
best-effort (FSD may not expose a calibrated probability → null → extension uses a
default).

## Conventions / rules
- Keep the capabilities separate; never one merged score.
- All platform DOM logic in adapters; anchor on stable selectors only.
- Service worker is the authoritative gate; UI locks are cosmetic.
- No durable state in SW globals — use chrome.storage.local.
- All injected UI in Shadow DOM, styled by content/styles.css.
- Prefix globals/keys with Verilens / verilens.
- Bands: green #2ecc71, amber #f39c12, red #e74c3c, grey #8b98a5.

## Dev/test
- Load unpacked at chrome://extensions, hard-refresh the social tab after edits.
- Flip tier: popup Developer → Plan toggle, or SW console
  `chrome.storage.local.set({verilens_tier:"premium"})`.
- SW logs: chrome://extensions → Verilens → "service worker". Content logs: page DevTools.
