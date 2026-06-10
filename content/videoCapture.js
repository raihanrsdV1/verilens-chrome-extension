// content/videoCapture.js
// Content-world helper for the REAL video deepfake path. The hosted VideoVeritas
// model needs to actually SEE the video. Getting the pixels is the hard part:
//
//  - Instagram / Twitter / Facebook stream video through MSE (MediaSource): the
//    <video> src is a `blob:` URL backed by a MediaSource, NOT a real file. You
//    CANNOT fetch() it (→ ERR_FILE_NOT_FOUND) and the service worker can't reach
//    it either. The bytes only ever exist inside the page's MediaSource.
//  - A small number of posts (and any direct .mp4) expose a fetchable https src.
//
// So we have two byte-acquisition strategies, tried in order by prepareThorough:
//   1. If the src is a fetchable https URL → let the worker fetch it (video_url).
//   2. Otherwise (MSE blob:) → grab real FRAMES off the live <video> via a
//      <canvas> and send them to the model as images. MSE-sourced video is
//      treated as same-origin, so canvas read-back is NOT tainted — this is the
//      one reliable way to get pixels out of an MSE player. We do NOT use
//      video.captureStream()/MediaRecorder: that crashed the renderer on these
//      players ("Aw, Snap!" / STATUS_BREAKPOINT).
//
// Frames are sampled only from the first `verilens_video_max_seconds` of the
// video (0 = whole video) — that's the user's "how much can the model see" knob.
(function (g) {
  const MAX_BYTES = 12 * 1024 * 1024;
  const MAX_SECONDS_KEY = "verilens_video_max_seconds";
  const DEFAULT_MAX_SECONDS = 20;

  // Frame-grab tuning. Keep the payload small and the capture quick.
  const FRAME_MAX_DIM = 480; // downscale longest side to this many px
  const FRAME_QUALITY = 0.7; // JPEG quality
  const MIN_FRAMES = 4;
  const MAX_FRAMES = 16;
  const SECONDS_PER_FRAME = 2.5; // ~1 frame every 2.5s of the chosen window
  const SEEK_TIMEOUT_MS = 1500;

  function alive() {
    return !!(g.chrome && g.chrome.runtime && g.chrome.runtime.id);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  // Fetch a URL → data URL, or null if it can't be read. MSE blob: URLs throw
  // here (ERR_FILE_NOT_FOUND) — that's expected; the caller falls back to frames.
  async function fromUrl(url) {
    if (!url) return null;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      if (!blob.size || blob.size > MAX_BYTES) return null;
      const dataUrl = await blobToDataUrl(blob);
      return { dataUrl, size: blob.size };
    } catch (e) {
      return null;
    }
  }

  // Best-effort <video> src inside a post element.
  function findVideoSrc(postEl) {
    const v = postEl && postEl.querySelector && postEl.querySelector("video");
    if (!v) return "";
    const source = v.querySelector && v.querySelector("source");
    return v.currentSrc || v.src || (source && source.src) || "";
  }

  // Reads the user's configured analysis length, in seconds. 0 = full video.
  async function getMaxSeconds() {
    if (!alive()) return DEFAULT_MAX_SECONDS;
    try {
      const o = await g.chrome.storage.local.get(MAX_SECONDS_KEY);
      const v = o[MAX_SECONDS_KEY];
      if (typeof v !== "number" || Number.isNaN(v) || v < 0) return DEFAULT_MAX_SECONDS;
      return v;
    } catch (e) {
      return DEFAULT_MAX_SECONDS;
    }
  }

  // Seek a <video> to time t and resolve once the frame at t is ready. Resolves
  // false on timeout (e.g. seeking past the buffered range).
  function seekTo(videoEl, t) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        videoEl.removeEventListener("seeked", onSeeked);
        clearTimeout(timer);
        resolve(ok);
      };
      const onSeeked = () => finish(true);
      const timer = setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
      videoEl.addEventListener("seeked", onSeeked);
      try {
        videoEl.currentTime = t;
      } catch (e) {
        finish(false);
      }
    });
  }

  // Grab real frames off a live <video> via canvas. Returns an array of JPEG data
  // URLs (frames sampled across the first `maxSeconds`), or null if it can't.
  async function captureFrames(videoEl, maxSeconds) {
    if (!videoEl) return null;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return null; // metadata not loaded / no decodable video

    const duration = isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : maxSeconds;

    // How far into the video we're allowed to look (the user's knob), clamped to
    // the actual duration AND to what's buffered (can't seek past buffered data).
    let windowEnd = Math.min(maxSeconds > 0 ? maxSeconds : duration, duration);
    try {
      const b = videoEl.buffered;
      if (b && b.length) {
        const bufEnd = b.end(b.length - 1);
        if (bufEnd > 0) windowEnd = Math.min(windowEnd, bufEnd);
      }
    } catch (e) {
      /* buffered access can throw — ignore */
    }
    if (!isFinite(windowEnd) || windowEnd <= 0) windowEnd = Math.min(maxSeconds > 0 ? maxSeconds : 5, 5);

    const numFrames = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(windowEnd / SECONDS_PER_FRAME)));

    const scale = Math.min(1, FRAME_MAX_DIM / Math.max(vw, vh));
    const cw = Math.max(1, Math.round(vw * scale));
    const ch = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Save and silence playback so seeking doesn't blast audio at the user.
    const wasPaused = videoEl.paused;
    const origTime = videoEl.currentTime;
    const wasMuted = videoEl.muted;
    videoEl.muted = true;
    try {
      videoEl.pause();
    } catch (e) {
      /* ignore */
    }

    const frames = [];
    let total = 0;
    for (let i = 0; i < numFrames; i++) {
      const t = (windowEnd / numFrames) * (i + 0.5); // centered sample points
      const ok = await seekTo(videoEl, t);
      if (!ok) continue;
      try {
        ctx.drawImage(videoEl, 0, 0, cw, ch);
        const url = canvas.toDataURL("image/jpeg", FRAME_QUALITY);
        if (url && url.length > 100) {
          frames.push(url);
          total += url.length;
          if (total > MAX_BYTES) break;
        }
      } catch (e) {
        // SecurityError → canvas tainted (DRM / true cross-origin). Give up.
        break;
      }
    }

    // Restore the user's playback state.
    try {
      videoEl.currentTime = origTime;
      videoEl.muted = wasMuted;
      if (!wasPaused) videoEl.play().catch(() => {});
    } catch (e) {
      /* ignore */
    }

    return frames.length ? frames : null;
  }

  // QUICK path (hover badge): just try reading blob: bytes directly. Fast, no
  // seeking/playback side-effects. MSE blobs fail → worker falls back to mock.
  async function prepare(videoUrl) {
    const out = { videoUrl: videoUrl || "" };
    if (videoUrl && videoUrl.startsWith("blob:")) {
      const cap = await fromUrl(videoUrl);
      if (cap && cap.dataUrl) out.videoDataUrl = cap.dataUrl;
    }
    return out;
  }

  // THOROUGH path ("Check media" click): get pixels to the model no matter what.
  //   1. blob: that's actually fetchable → videoDataUrl (rare).
  //   2. otherwise (MSE blob:) → real frames off the <video> via canvas.
  //   3. https src → leave videoUrl for the worker to fetch.
  // `videoEl` is the live <video> in the post (needed for frame capture).
  async function prepareThorough(videoUrl, videoEl) {
    const out = { videoUrl: videoUrl || "" };
    const maxSeconds = await getMaxSeconds();
    out.videoMaxSeconds = maxSeconds;

    if (videoUrl && videoUrl.startsWith("blob:")) {
      const cap = await fromUrl(videoUrl);
      if (cap && cap.dataUrl) {
        out.videoDataUrl = cap.dataUrl;
        return out;
      }
      const frames = await captureFrames(videoEl, maxSeconds);
      if (frames) out.videoFrames = frames;
    }
    return out;
  }

  g.VerilensVideoCapture = { fromUrl, findVideoSrc, prepare, prepareThorough, captureFrames };
})(window);
