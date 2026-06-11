// content/imageHover.js
// Hover-triggered deepfake detection badge on images and videos.
// When the user hovers over a content image or video for 400ms, a small
// badge appears in the top-right corner of the media and the scan fires.
// Results are cached on the element so repeated hovers are instant.
(function () {
  const resultCache = new WeakMap(); // element → verdict (in-memory, survives SPA navigation)
  let badge = null;
  let badgeTarget = null;
  let detectTimer = null;
  let leaveTimer = null;

  function alive() {
    return !!(window.chrome && chrome.runtime && chrome.runtime.id);
  }

  // ── Auto-detect toggle ───────────────────────────────────────────────────────
  // verilens_hover_detect_enabled (default false). Read once on load and kept in
  // sync via storage.onChanged so the popup toggle takes effect immediately.
  const HOVER_SETTING_KEY = "verilens_hover_detect_enabled";
  let hoverEnabled = false;

  if (alive()) {
    chrome.storage.local.get(HOVER_SETTING_KEY).then((o) => {
      hoverEnabled = o[HOVER_SETTING_KEY] === true;
    }).catch(() => {});

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[HOVER_SETTING_KEY]) return;
      hoverEnabled = changes[HOVER_SETTING_KEY].newValue === true;
      if (!hoverEnabled) {
        clearTimeout(detectTimer);
        destroyBadge();
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Returns the canonical media element to use as the badge anchor:
  //   - the <img> itself (if large enough and not an avatar)
  //   - the <video> itself (if large enough)
  //   - the nearest large-enough ancestor that CONTAINS a <video> (if the
  //     hovered element is an overlay div sitting on top of the player)
  //   - null otherwise
  function findMediaTarget(hovered) {
    // 1. Direct <img> hit
    if (hovered.tagName === "IMG") {
      const src = hovered.src || "";
      if (/profile_images|avatar|emoji|icon|logo/i.test(src)) return null;
      const r = hovered.getBoundingClientRect();
      return (r.width >= 100 && r.height >= 100) ? hovered : null;
    }

    // 2. Direct <video> hit
    if (hovered.tagName === "VIDEO") {
      const r = hovered.getBoundingClientRect();
      return (r.width >= 100 && r.height >= 100) ? hovered : null;
    }

    // 3. Walk up the DOM looking for an ancestor that CONTAINS a <video>.
    //    Every platform (X, Instagram, Facebook) renders overlay <div>s
    //    (controls, play button, gradients) on top of the <video> tag, so
    //    the hovered element is rarely the <video> itself.
    let node = hovered;
    for (let depth = 0; node && depth < 6; depth++) {
      const video = node.querySelector && node.querySelector("video");
      if (video) {
        const r = node.getBoundingClientRect();
        if (r.width >= 100 && r.height >= 100) return node;
      }
      node = node.parentElement;
    }

    return null;
  }

  // True when the candidate element is a video (or video container div)
  function isVideo(el) {
    if (!el) return false;
    if (el.tagName === "VIDEO") return true;
    return !!el.querySelector("video");
  }

  function getCornerPos(el) {
    const r = el.getBoundingClientRect();
    return {
      top: r.top + 10,
      right: window.innerWidth - r.right + 10,
    };
  }

  // ── Badge rendering ──────────────────────────────────────────────────────────

  function destroyBadge() {
    if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    badge = null;
    badgeTarget = null;
  }

  function createBadge(el) {
    destroyBadge();
    const { top, right } = getCornerPos(el);
    const b = document.createElement("div");
    b.style.cssText =
      "position:fixed;" +
      "top:" + top + "px;" +
      "right:" + right + "px;" +
      "z-index:2147483647;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
      "background:rgba(14,15,18,0.92);" +
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
      "border:1px solid rgba(255,255,255,0.12);" +
      "border-radius:10px;" +
      "padding:9px 13px;" +
      "color:#e7e9ea;" +
      "font-size:13px;" +
      "min-width:145px;" +
      "pointer-events:none;" +
      "box-shadow:0 4px 24px rgba(0,0,0,0.6);" +
      "transition:opacity 0.15s ease;";
    document.body.appendChild(b);
    badge = b;
    badgeTarget = el;
    return b;
  }

  function showDetecting(el) {
    const b = createBadge(el);
    const isVid = isVideo(el);

    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;font-weight:700">' +
      "<span>🔍</span><span>Detecting...</span></div>" +
      (isVid
        ? '<div style="margin-top:5px;font-size:11px;color:#8b98a5">Sampling frames at 24fps</div>' +
          '<div style="margin-top:5px;height:3px;background:#2f3336;border-radius:2px;overflow:hidden">' +
          '<div id="vl-pbar" style="height:100%;width:0%;background:#1d9bf0;border-radius:2px;' +
          'transition:width 0.6s ease"></div></div>'
        : "");

    if (isVid) {
      setTimeout(() => {
        const bar = b.querySelector("#vl-pbar");
        if (bar) bar.style.width = "55%";
      }, 80);
      setTimeout(() => {
        const bar = b.querySelector("#vl-pbar");
        if (bar) bar.style.width = "88%";
      }, 600);
    }
  }

  function showResult(el, result) {
    if (!badge || badgeTarget !== el) return;

    // Reposition in case of scroll
    const { top, right } = getCornerPos(el);
    badge.style.top = top + "px";
    badge.style.right = right + "px";
    badge.style.pointerEvents = "auto";

    if (result.gated) {
      badge.innerHTML =
        '<div style="font-weight:700;font-size:12px;color:#c9b27a">🔒 Premium</div>' +
        '<div style="font-size:11px;color:#8b98a5;margin-top:3px">Video analysis requires Premium</div>';
      return;
    }

    if (result.error) {
      badge.innerHTML =
        '<div style="color:#e74c3c;font-size:12px">⚠ Could not check media</div>';
      return;
    }

    const band = result.band || "amber";
    const colors = { green: "#2ecc71", amber: "#f39c12", red: "#e74c3c" };
    const emojis = { green: "✅", amber: "⚠️", red: "🤖" };
    const verdictLabels = { green: "Likely Real", amber: "Uncertain", red: "AI Generated" };
    const color = colors[band] || "#8b98a5";

    // Pull confidence from whichever media type was analyzed
    let conf = null;
    if (result.confirmed) {
      conf = 0.99;
    } else if (result.media) {
      const m = result.media;
      if (m.image && typeof m.image.aiGenerated === "number") conf = m.image.aiGenerated;
      else if (m.video && typeof m.video.aiGenerated === "number") conf = m.video.aiGenerated;
    }

    badge.style.borderLeft = "3px solid " + color;
    badge.style.borderRadius = "4px 10px 10px 4px";

    badge.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;font-weight:700;color:' + color + '">' +
      "<span>" + (emojis[band] || "⚠️") + "</span>" +
      "<span>" + (verdictLabels[band] || "Uncertain") + "</span></div>" +
      (conf !== null
        ? '<div style="margin-top:3px;font-size:12px;color:#8b98a5">Confidence: ' +
          (conf * 100).toFixed(1) + "%</div>"
        : "") +
      (result.confirmed
        ? '<div style="margin-top:3px;font-size:11px;color:#e74c3c;font-weight:600">' +
          (result.confirmed === "c2pa" ? "✓ C2PA Verified" : "✓ SynthID Watermark") +
          "</div>"
        : "");
  }

  // ── Detection ────────────────────────────────────────────────────────────────

  async function detect(el) {
    if (!alive() || badgeTarget !== el) return;

    const isVid = isVideo(el);
    const videoEl = isVid && el.tagName !== "VIDEO" ? el.querySelector("video") : el;
    const src = (videoEl && (videoEl.src || videoEl.currentSrc)) || el.src || el.currentSrc || "";
    const imageUrls = isVid ? [] : (src ? [src] : []);
    const contentHash = window.VerilensHash
      ? window.VerilensHash.contentHash(imageUrls, "")
      : "h_hover_" + src.slice(-24);

    const payload = {
      postId: "hover_" + contentHash,
      postUrl: window.location.href,
      contentHash,
      imageUrls,
      captionText: "",
      hasVideo: isVid,
      hasAudio: false,
    };

    // For videos, hand the real VideoVeritas backend the bytes/URL it needs. blob:
    // srcs are captured here; https srcs are passed for the worker to fetch.
    if (isVid && window.VerilensVideoCapture) {
      payload.videoUrl = src;
      const extra = await window.VerilensVideoCapture.prepare(src);
      Object.assign(payload, extra);
    }

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "SCAN_DEEPFAKE", payload });
    } catch (e) {
      res = { error: String(e) };
    }

    // Only update UI if the user is still hovering this element
    if (badgeTarget !== el) return;

    resultCache.set(el, res);
    showResult(el, res);
  }

  // ── Event handling ───────────────────────────────────────────────────────────

  function onMouseOver(e) {
    if (!hoverEnabled) return;
    const target = findMediaTarget(e.target);
    if (!target) return;
    clearTimeout(leaveTimer);

    // Instant render for cached results
    if (resultCache.has(target)) {
      if (badgeTarget === target) return; // already showing
      createBadge(target);
      showResult(target, resultCache.get(target));
      return;
    }

    // 400ms hover intent threshold — prevents flashing on quick mouse movements
    clearTimeout(detectTimer);
    detectTimer = setTimeout(() => {
      showDetecting(target);
      detect(target);
    }, 400);
  }

  function onMouseOut(e) {
    // For video containers, check if we're leaving the container itself.
    // For regular elements, check the direct target.
    if (!badgeTarget) return;
    const leaving = e.target;
    // If mouse moves to a child of badgeTarget (e.g. overlay div inside player), ignore.
    if (badgeTarget.contains(leaving) && badgeTarget !== leaving) return;
    // If mouse moves OUT of the badgeTarget (or out of a child that IS the badgeTarget)
    const related = e.relatedTarget;
    if (related && badgeTarget.contains(related)) return;
    clearTimeout(detectTimer);

    // Short grace period — prevents flickering
    leaveTimer = setTimeout(destroyBadge, 250);
  }

  function attach() {
    // Capture phase so we see events inside React's synthetic event system
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
  }

  // Master switch (verilens_scanning_enabled, default true). Read once at
  // injection time — if OFF, this page load attaches nothing.
  if (alive()) {
    chrome.storage.local
      .get("verilens_scanning_enabled")
      .then((o) => {
        if (o.verilens_scanning_enabled !== false) attach();
      })
      .catch(attach);
  } else {
    attach();
  }
})();
    
    if (badge && badge.contains(related)) return;

    if (e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom) {
      return; 
    }

    clearTimeout(detectTimer);
    leaveTimer = setTimeout(destroyBadge, 250);
  }

  // Capture phase so we see events inside React's synthetic event system
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
})();
