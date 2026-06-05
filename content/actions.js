// content/actions.js
// Renders the per-post controls and owns the Shadow DOM host for each post.
//
// Why Shadow DOM: it isolates our CSS from the site's CSS (and vice-versa) so
// X's stylesheet can't break our panel and ours can't leak into the page.
// One host per post holds BOTH the control bar and the result panel.
(function (g) {
  const Tiers = g.VerilensTiers;

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function getTier() {
    return chrome.runtime.sendMessage({ type: "GET_TIER" }).then((r) => (r && r.tier) || "free");
  }

  // Create (once) the shadow host for a post and return its inner mount div.
  function ensureMount(postEl, anchor) {
    if (postEl.__verilensMount) return postEl.__verilensMount;

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

  async function runDeepfake(data, mount, btn) {
    let res;
    await withLoading(btn, "Checking…", async () => {
      try {
        res = await chrome.runtime.sendMessage({ type: "SCAN_DEEPFAKE", payload: data });
      } catch (e) {
        res = { error: String(e) };
      }
    });
    g.VerilensBadge.renderDeepfake(mount, res);
  }

  async function runFactcheck(data, mount, btn, refreshControls) {
    let res;
    await withLoading(btn, "Checking…", async () => {
      try {
        res = await chrome.runtime.sendMessage({ type: "SCAN_FACTCHECK", payload: data });
      } catch (e) {
        res = { error: String(e) };
      }
    });

    if (res && res.gated) {
      g.VerilensBadge.renderUpgrade(mount, res, {
        onUpgrade: () => {
          // Real upgrade/account flow lands in M4. For now, a quiet inline note.
          alert("Verilens Premium — checkout flow coming soon.");
        },
        onDevEnable: async () => {
          await chrome.runtime.sendMessage({ type: "SET_TIER", tier: "premium" });
          if (refreshControls) await refreshControls(); // drop the lock on the button
          runFactcheck(data, mount, btn, refreshControls); // re-run now that we're premium
        },
      });
      return;
    }

    g.VerilensBadge.renderFactcheck(mount, res);
  }

  // Public: attach the control bar for a post.
  async function attach(postEl, data, anchor) {
    const mount = ensureMount(postEl, anchor);
    if (mount.querySelector(".verilens-bar")) return; // already attached

    const bar = el("div", "verilens-bar");
    bar.append(el("span", "verilens-brand", "🛡 Verilens"));

    // Deepfake (image) is free — no gate.
    const checkBtn = el("button", "verilens-btn", "Check media");
    checkBtn.title = "Run AI deepfake detection on this image";
    checkBtn.addEventListener("click", () => runDeepfake(data, mount, checkBtn));
    bar.append(checkBtn);

    // Fact-check is premium. We show a lock when the user can't use it, but the
    // worker remains the source of truth on the gate.
    const factBtn = el("button", "verilens-btn", "Fact-check");
    factBtn.title = "Verify the claims in this post against trusted sources";

    async function refreshControls() {
      const tier = await getTier();
      const locked = !Tiers.isAllowed("factCheck", tier);
      factBtn.textContent = locked ? "🔒 Fact-check" : "Fact-check";
      factBtn.classList.toggle("locked", locked);
    }

    factBtn.addEventListener("click", () => runFactcheck(data, mount, factBtn, refreshControls));
    bar.append(factBtn);

    mount.append(bar);

    // Decorate the lock state (async; the bar shows immediately meanwhile).
    refreshControls();
  }

  g.VerilensActions = { attach };
})(globalThis);
