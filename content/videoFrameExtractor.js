(function (g) {
  var MAX_FRAMES = 10;
  var FPS = 1;
  var JPEG_QUALITY = 0.85;

  async function extractVideoFrames(videoEl) {
    if (!videoEl || !(videoEl instanceof HTMLVideoElement)) return [];

    var duration = videoEl.duration;
    if (!duration || !isFinite(duration) || duration <= 0) return [];

    // Try to request CORS — works if the CDN sends Access-Control-Allow-Origin
    // headers. If not, toDataURL will taint the canvas and we skip that frame.
    try { videoEl.crossOrigin = "anonymous"; } catch (_) {}

    var interval = Math.max(1, 1 / FPS);
    var frameCount = Math.min(Math.floor(duration / interval), MAX_FRAMES);
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var frames = [];

    for (var i = 0; i < frameCount; i++) {
      var time = i * interval;
      videoEl.currentTime = time;
      await new Promise(function (resolve) {
        videoEl.onseeked = function () {
          try {
            canvas.width = videoEl.videoWidth || 640;
            canvas.height = videoEl.videoHeight || 360;
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

            var maxDim = Math.max(canvas.width, canvas.height);
            var outCanvas = canvas;
            if (maxDim > 1280) {
              var scale = 1280 / maxDim;
              var small = document.createElement("canvas");
              small.width = Math.round(canvas.width * scale);
              small.height = Math.round(canvas.height * scale);
              small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
              outCanvas = small;
            }

            try {
              frames.push(outCanvas.toDataURL("image/jpeg", JPEG_QUALITY));
            } catch (_) {
              // Cross-origin video taints the canvas — skip this frame.
              // The video URL is still sent for server-side transcription.
            }
          } catch (_) {}
          resolve();
        };
      });
    }

    return frames;
  }

  function findVideoElement(adapter, postEl) {
    var selectors = [
      "video",
      '[data-testid="videoPlayer"] video',
      '[data-testid="videoComponent"] video',
      '[data-testid="tweetVideo"] video',
    ];
    if (postEl) {
      for (var j = 0; j < selectors.length; j++) {
        var el = postEl.querySelector(selectors[j]);
        if (el) return el;
      }
    }
    return document.querySelector("video");
  }

  g.VerilensVideoFrames = { extractVideoFrames: extractVideoFrames, findVideoElement: findVideoElement };
})(globalThis);
