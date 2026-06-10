// content/actions.js
// Renders the per-post controls and owns the Shadow DOM host for each post.
//
// Why Shadow DOM: it isolates our CSS from the site's CSS (and vice-versa) so
// X's stylesheet can't break our panel and ours can't leak into the page.
// One host per post holds BOTH the control bar and the result panel.
(function (g) {
  const Tiers = g.VerilensTiers;

  // Flip to false to silence dev logs. When true, every request we build and
  // every response we get is printed to THIS page's DevTools console, tagged
  // [Verilens], so you can verify the extracted payload is real — not just that
  // the UI rendered something.
  const DEBUG = true;
  function log(...args) {
    if (DEBUG) console.log("%c[Verilens]", "color:#1d9bf0;font-weight:bold", ...args);
  }

  // After the extension is reloaded/updated, content scripts already on the page
  // are orphaned: chrome.runtime is dead and any getURL/sendMessage throws
  // "Extension context invalidated". Guard with this and fail quietly; a tab
  // refresh re-injects a fresh script.
  function alive() {
    return !!(g.chrome && chrome.runtime && chrome.runtime.id);
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function getTier() {
    if (!alive()) return Promise.resolve("free");
    return chrome.runtime
      .sendMessage({ type: "GET_TIER" })
      .then((r) => (r && r.tier) || "free")
      .catch(() => "free");
  }

  // Only worth the cost of capturing/recording video frames if a real backend
  // is actually configured (lib/config.local.js) — otherwise the mock will be
  // used and doesn't need video bytes at all.
  function backendConfigured() {
    const url = g.VerilensConfig && g.VerilensConfig.videoBackendUrl;
    return Promise.resolve(!!(url && String(url).trim()));
  }

  // Create (once) the shadow host for a post and return its inner mount div.
  function ensureMount(postEl, anchor) {
    if (postEl.__verilensMount) return postEl.__verilensMount;
    if (!alive()) return null; // orphaned script — getURL would throw

    const host = el("div", "verilens-host");
    // Reset inherited layout so the host doesn't pick up X's flex/markup quirks.
    host.style.all = "initial";
    host.style.display = "block";

    const root = host.attachShadow({ mode: "open" });

    // Load our stylesheet INTO the shadow root (declared in
    // web_accessible_resources). Scoped to this shadow tree only.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content/styles.css");
    root.append(link);

    const mount = el("div", "verilens-root");
    root.append(mount);

    // Insert at the adapter-chosen anchor.
    if (anchor && anchor.parent) {
      anchor.parent.insertBefore(host, anchor.before || null);
    } else {
      postEl.append(host);
    }

    postEl.__verilensMount = mount;
    return mount;
  }

  // Generic "run a scan button": handle loading/disabled/restore around a call.
  async function withLoading(btn, loadingText, fn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.classList.add("loading");
    btn.textContent = loadingText;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.textContent = original;
    }
  }

  // Shared upgrade-card handlers: a placeholder checkout, plus a dev shortcut
  // that flips the tier to premium, refreshes the button locks, and re-runs.
  function makeUpgradeHandlers(refreshControls, rerun) {
    return {
      onUpgrade: () => {
        // Real upgrade/account flow lands in M4. For now, a quiet inline note.
        alert("Verilens Premium — checkout flow coming soon.");
      },
      onDevEnable: async () => {
        if (!alive()) return;
        try {
          await chrome.runtime.sendMessage({ type: "SET_TIER", tier: "premium" });
          if (refreshControls) await refreshControls();
          if (rerun) rerun();
        } catch (e) {
          /* dead context — ignore */
        }
      },
    };
  }

  async function runDeepfake(data, mount, btn, refreshControls, postEl) {
    let res;
    await withLoading(btn, "Checking…", async () => {
      // For videos, get pixels to the real VideoVeritas backend + pass the user's
      // configured "video analysis length". For MSE blob: videos (IG/X/FB) this
      // grabs real frames off the live <video> via canvas, so we need the element.
      // Only worth doing when a real backend is actually configured (the mock
      // doesn't need video bytes).
      let payload = data;
      if (data.hasVideo && g.VerilensVideoCapture && (await backendConfigured())) {
        const videoEl = postEl && postEl.querySelector && postEl.querySelector("video");
        const extra = await g.VerilensVideoCapture.prepareThorough(data.videoUrl, videoEl);
        payload = { ...data, ...extra };
      }
      log("→ SCAN_DEEPFAKE request payload:", payload);
      try {
        res = await chrome.runtime.sendMessage({ type: "SCAN_DEEPFAKE", payload });
      } catch (e) {
        res = { error: String(e) };
      }
    });
    log("← deepfake result:", res);

    // Video/audio-only deepfake is premium → the worker may gate it.
    if (res && res.gated) {
      g.VerilensBadge.renderUpgrade(
        mount,
        { kind: "deepfake", message: res.message },
        makeUpgradeHandlers(refreshControls, () => runDeepfake(data, mount, btn, refreshControls, postEl))
      );
      return;
    }

    g.VerilensBadge.renderDeepfake(mount, res);
  }

  async function runFactcheck(data, mount, btn, refreshControls, postEl) {
    log("→ SCAN_FACTCHECK request payload:", data);
    let res;
    await withLoading(btn, "Checking…", async () => {
      try {
        if (data.hasVideo && postEl) {
          try {
            const videoEl = window.VerilensVideoFrames.findVideoElement(null, postEl);
            if (videoEl) {
              data.videoFrames = await window.VerilensVideoFrames.extractVideoFrames(videoEl);
              if (data.videoFrames.length > 0) {
                console.log("[Verilens] Extracted", data.videoFrames.length, "video frames for factcheck");
              }
            }
          } catch (e) {
            console.warn("[Verilens] Video frame extraction failed:", e);
          }
        }
        if (data.hasVideo) {
          const Adapters = window.VerilensAdapters || {};
          const h = location.hostname;
          const a = h.endsWith("x.com") || h.endsWith("twitter.com") ? Adapters.twitter :
                    h.endsWith("instagram.com") ? Adapters.instagram :
                    h.endsWith("facebook.com") ? Adapters.facebook : null;
          if (a && a.extractVideoUrl) {
            const videoUrl = a.extractVideoUrl(postEl);
            if (videoUrl) data.videoUrl = videoUrl;
          }
        }
        res = await chrome.runtime.sendMessage({ type: "SCAN_FACTCHECK", payload: data });
      } catch (e) {
        res = { error: String(e) };
      }
    });
    log("← factcheck result:", res);

    if (res && res.gated) {
      g.VerilensBadge.renderUpgrade(
        mount,
        { kind: "factcheck", message: res.message },
        makeUpgradeHandlers(refreshControls, () => runFactcheck(data, mount, btn, refreshControls, postEl))
      );
      return;
    }

    g.VerilensBadge.renderFactcheck(mount, res);
  }

  // Public: attach the control bar for a post. Which buttons appear — and which
  // are locked — depends on what the post actually contains:
  //   - deepfake button: shown if there's media (image OR video).
  //       image  → free (deepfakeImage)
  //       video  → premium (deepfakeVideo), shown locked for free users
  //   - fact-check button: shown if there's text to verify; always premium.
  async function attach(postEl, data, anchor) {
    if (!alive()) return;

    const hasImage = data.imageUrls.length > 0;
    const hasVideo = !!data.hasVideo;
    const hasText = (data.captionText || "").trim().length > 0;
    const showDeepfake = hasImage || hasVideo;
    const showFactcheck = hasText;
    if (!showDeepfake && !showFactcheck) return;

    const mount = ensureMount(postEl, anchor);
    if (!mount) return; // dead context
    if (mount.querySelector(".verilens-bar")) return; // already attached

    const bar = el("div", "verilens-bar");
    bar.append(el("span", "verilens-brand", "🛡 Verilens"));

    let checkBtn = null;
    let factBtn = null;

    // The deepfake gate depends on the media type: image is free, video is not.
    const deepfakeFeature = hasImage ? "deepfakeImage" : "deepfakeVideo";

    if (showDeepfake) {
      checkBtn = el("button", "verilens-btn verilens-btn-primary", "🔍 Check media");
      checkBtn.title = hasImage
        ? "Run AI deepfake detection on this image"
        : "Run AI deepfake detection on this video (Premium)";
      checkBtn.addEventListener("click", () => runDeepfake(data, mount, checkBtn, refreshControls, postEl));
      bar.append(checkBtn);
    }

    if (showFactcheck) {
      factBtn = el("button", "verilens-btn verilens-btn-secondary", "📰 Fact-check");
      factBtn.title = "Verify the claims in this post against trusted sources";
      factBtn.addEventListener("click", () => runFactcheck(data, mount, factBtn, refreshControls, postEl));
      bar.append(factBtn);
    }

    // Reflect lock state for the current tier on whichever buttons exist. The
    // worker remains the authoritative gate; locks are a visual hint.
    async function refreshControls() {
      const tier = await getTier();
      if (checkBtn) {
        const locked = !Tiers.isAllowed(deepfakeFeature, tier);
        checkBtn.textContent = locked ? "🔒 Check media" : "🔍 Check media";
        checkBtn.classList.toggle("locked", locked);
      }
      if (factBtn) {
        const locked = !Tiers.isAllowed("factCheck", tier);
        factBtn.textContent = locked ? "🔒 Fact-check" : "📰 Fact-check";
        factBtn.classList.toggle("locked", locked);
      }
    }

    mount.append(bar);
    refreshControls().catch(() => {});
  }

  g.VerilensActions = { attach };
})(globalThis);
