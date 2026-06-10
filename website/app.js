// website/app.js
// Theme toggle, monthly/annual billing switch, and the (demo) Purchase action.
// No build step — plain DOM. Reads pricing from window.VerilensSite (config.js).
(function () {
  const CFG = window.VerilensSite;
  const THEME_KEY = "verilens_site_theme";

  // ---- Theme ----------------------------------------------------------------
  const root = document.documentElement;
  const themeBtn = document.getElementById("themeToggle");

  // Inline SVG line icons (sun / moon) — no emoji.
  const ICON_SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const ICON_MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    // Show the icon for the mode you'd switch TO.
    themeBtn.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");

  themeBtn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  // ---- Scroll progress bar --------------------------------------------------
  const progress = document.getElementById("scrollProgress");
  function updateProgress() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
    progress.style.width = pct + "%";
  }
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
  updateProgress();

  // ---- Billing toggle -------------------------------------------------------
  const billingToggle = document.getElementById("billingToggle");
  const proAmount = document.getElementById("proAmount");
  const proPer = document.getElementById("proPer");
  const proSubprice = document.getElementById("proSubprice");
  const saveChip = document.getElementById("saveChip");
  const labelMonthly = document.getElementById("labelMonthly");
  const labelAnnual = document.getElementById("labelAnnual");

  saveChip.textContent = CFG.prices.annual.savingsLabel;

  function renderPrice() {
    const annual = billingToggle.checked;
    const p = annual ? CFG.prices.annual : CFG.prices.monthly;
    proAmount.textContent = "$" + p.amount;
    proPer.textContent = p.suffix;
    proSubprice.textContent = annual
      ? "Billed yearly · $" + CFG.prices.annual.perMonth + "/mo effective"
      : "Billed monthly";
    labelMonthly.setAttribute("data-active", String(!annual));
    labelAnnual.setAttribute("data-active", String(annual));
  }
  billingToggle.addEventListener("change", renderPrice);
  renderPrice();

  // ---- Purchase (demo) ------------------------------------------------------
  // No payment/account. We drop a flag in localStorage that the extension's
  // content script (content/purchaseUnlock.js) reads on the localhost page, then
  // go to the confirmation page which reports whether the extension picked it up.
  document.getElementById("purchaseBtn").addEventListener("click", () => {
    localStorage.setItem("verilens_purchase", "premium");
    window.location.href = "success.html";
  });
})();
