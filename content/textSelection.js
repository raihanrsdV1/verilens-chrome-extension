// content/textSelection.js
// Listens for text selections on the page and shows a floating "🛡 Check AI"
// button above the highlighted text. The host element uses a Shadow DOM so
// our CSS is fully isolated from the page (and vice-versa).
(function () {
  let popoverHost = null;
  let selectionTimeout = null;

  function alive() {
    return !!(window.chrome && chrome.runtime && chrome.runtime.id);
  }

  function removePopover() {
    clearTimeout(selectionTimeout);
    if (popoverHost && popoverHost.parentNode) {
      popoverHost.parentNode.removeChild(popoverHost);
    }
    popoverHost = null;
  }

  // Creates a fixed-position host element above the selection rect,
  // attaches a shadow root, and returns the inner mount div.
  function createPopover(rect) {
    if (!alive()) return null;

    const host = document.createElement("div");

    // IMPORTANT: Set all layout-critical styles BEFORE anything else.
    // Do NOT use `style.all = "initial"` here — it would wipe these out.
    // The Shadow DOM already handles CSS isolation from the page.
    host.style.cssText = [
      "position: fixed",
      "top: " + Math.max(rect.top - 44, 4) + "px",
      "left: " + (rect.left + rect.width / 2) + "px",
      "transform: translateX(-50%)",
      "z-index: 2147483647", // max z-index
      "pointer-events: auto",
    ].join("; ");

    const root = host.attachShadow({ mode: "open" });

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content/styles.css");
    root.append(link);

    const mount = document.createElement("div");
    mount.className = "verilens-root";
    mount.style.cssText = "margin: 0; padding: 0;"; // no extra spacing when floating
    root.append(mount);

    document.body.append(host);
    popoverHost = host;
    return mount;
  }

  // --- DOM helpers ---
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  // Renders the initial "🛡 Check AI" trigger button.
  function renderButton(mount, text) {
    mount.innerHTML = "";
    const btn = el("button", "verilens-text-btn", "🛡 Check AI");
    btn.addEventListener("click", () => runDetection(mount, text));
    mount.append(btn);
  }

  // Sends the text to the service worker and renders the result.
  async function runDetection(mount, text) {
    mount.innerHTML = "";
    const panel = el("div", "verilens-panel");
    panel.style.cssText = "margin-top: 0; box-shadow: 0 8px 24px rgba(0,0,0,0.6); min-width: 260px;";

    const head = el("div", "verilens-section-head");
    head.append(el("span", "verilens-section-title", "AI Text Detection"));
    panel.append(head);
    panel.append(el("div", "verilens-explain", "Checking text…"));
    mount.append(panel);

    const textHash = "h_" + (
      window.VerilensHash
        ? window.VerilensHash.fnv1a(text)
        : Math.abs(text.split("").reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193) | 0, 0x811c9dc5)).toString(16)
    );

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "DETECT_TEXT", payload: { text, textHash } });
    } catch (e) {
      res = { error: String(e) };
    }

    // Re-render panel with the result.
    panel.innerHTML = "";
    const newHead = el("div", "verilens-section-head");
    newHead.append(el("span", "verilens-section-title", "AI Text Detection"));
    if (res && res.cached) newHead.append(el("span", "verilens-chip", "cached"));
    panel.append(newHead);

    if (res && res.error) {
      panel.append(el("div", "verilens-error", "Error: " + res.error));
      return;
    }

    if (res && res.gated) {
      const card = el("div", "verilens-upgrade");
      card.append(el("div", "verilens-upgrade-title", "🔒 Premium feature"));
      card.append(el("p", "verilens-explain", res.message));

      const cta = el("button", "verilens-cta", "Upgrade to Premium");
      cta.addEventListener("click", () => alert("Verilens Premium — checkout flow coming soon."));
      card.append(cta);

      const dev = el("button", "verilens-dev-link", "Enable premium (dev)");
      dev.addEventListener("click", async () => {
        if (!alive()) return;
        try {
          await chrome.runtime.sendMessage({ type: "SET_TIER", tier: "premium" });
          runDetection(mount, text);
        } catch (_) {}
      });
      card.append(dev);
      panel.append(card);
      return;
    }

    const band = (res && res.band) || "grey";
    const row = el("div", "verilens-verdict-row " + band);
    row.append(el("span", "verilens-dot"));
    const labels = { green: "Likely human", amber: "Mixed signals", red: "Likely AI-written" };
    row.append(el("span", "verilens-verdict-label", labels[band] || "Unknown"));
    if (res && typeof res.aiGenerated === "number") {
      row.append(el("span", "verilens-prob", Math.round(res.aiGenerated * 100) + "% AI"));
    }
    panel.append(row);

    if (res && res.explanation) {
      panel.append(el("p", "verilens-explain", res.explanation));
    }
  }

  // --- Selection handling ---
  function handleSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      removePopover();
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 10) {
      removePopover();
      return;
    }

    // Debounce: wait until the user stops dragging before positioning the button.
    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(() => {
      const currentSel = window.getSelection();
      if (!currentSel || currentSel.isCollapsed || currentSel.rangeCount === 0) return;
      const currentText = currentSel.toString().trim();
      if (currentText.length < 10) return;

      const range = currentSel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      removePopover(); // clear any existing one
      const mount = createPopover(rect);
      if (mount) renderButton(mount, currentText);
    }, 300);
  }

  // The `selectionchange` event fires on the document whenever the selection changes.
  // This works reliably in SPAs like X/Twitter regardless of React's event handling.
  document.addEventListener("selectionchange", handleSelectionChange);

  // When the user clicks anywhere EXCEPT our popover, dismiss it.
  // We must use capture=true so we get this before X's React handlers.
  document.addEventListener("mousedown", (e) => {
    if (!popoverHost) return;
    // If the click is inside our shadow host, preserve the popover.
    if (popoverHost.contains(e.target)) {
      // Prevent the click from clearing the text selection (which would trigger
      // selectionchange and destroy the popover before the click fires).
      e.preventDefault();
      return;
    }
    // Click is outside — dismiss.
    removePopover();
  }, true);

})();
