(function (g) {
  const MAX_FRAMES = 10;
  const FPS = 1;
  const JPEG_QUALITY = 0.85;

  async function extractVideoFrames(videoEl) {
    if (!videoEl || !(videoEl instanceof HTMLVideoElement)) return [];

    const duration = videoEl.duration;
    if (!duration || !isFinite(duration) || duration <= 0) return [];

    const interval = Math.max(1, 1 / FPS);
    const frameCount = Math.min(Math.floor(duration / interval), MAX_FRAMES);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const frames = [];

    for (let i = 0; i < frameCount; i++) {
      const time = i * interval;
      videoEl.currentTime = time;
      await new Promise((resolve) => {
        videoEl.onseeked = () => {
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
          ctx.drawImage(videoEl, 0, 0);
          const maxDim = Math.max(canvas.width, canvas.height);
          if (maxDim > 1280) {
            const scale = 1280 / maxDim;
            const w = Math.round(canvas.width * scale);
            const h = Math.round(canvas.height * scale);
            const small = document.createElement("canvas");
            small.width = w;
            small.height = h;
            small.getContext("2d").drawImage(canvas, 0, 0, w, h);
            frames.push(small.toDataURL("image/jpeg", JPEG_QUALITY));
          } else {
            frames.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
          }
          resolve();
        };
      });
    }

    return frames;
  }

  function findVideoElement(adapter, postEl) {
    const selectors = [
      "video",
      '[data-testid="videoPlayer"] video',
      '[data-testid="videoComponent"] video',
      '[data-testid="tweetVideo"] video',
    ];
    if (postEl) {
      for (const sel of selectors) {
        const el = postEl.querySelector(sel);
        if (el) return el;
      }
    }
    return document.querySelector("video");
  }

  g.VerilensVideoFrames = { extractVideoFrames, findVideoElement };
})(globalThis);
