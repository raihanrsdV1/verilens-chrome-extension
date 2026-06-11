// content/purchaseUnlock.js
// Bridges the (local) Verilens marketing site to the extension. Injected only on
// localhost (see manifest.json). When the site's Purchase button has set
// localStorage["verilens_purchase"]="premium", we flip the extension to Premium via
// the existing SET_TIER service-worker handler — no backend, no payment.
//
// We also stamp <html data-verilens-installed="1"> so success.html can confirm the
// extension is present (otherwise it shows a manual fallback).
(function () {
  function markPresent() {
    document.documentElement.dataset.verilensInstalled = "1";
  }

  function tryUnlock() {
    let flag;
    try {
      flag = window.localStorage.getItem("verilens_purchase");
    } catch (e) {
      return; // localStorage blocked — nothing to do
    }
    markPresent(); // extension is here regardless of the flag
    if (flag !== "premium") return;

    // Clear first so a refresh doesn't re-fire, then flip the tier.
    try {
      window.localStorage.removeItem("verilens_purchase");
    } catch (e) {}
    chrome.runtime.sendMessage({ type: "SET_TIER", tier: "premium" });
  }

  tryUnlock();
  // Fire again if the flag is set after we loaded (e.g. injected before the click,
  // or the page writes it then same-document navigates).
  window.addEventListener("storage", (e) => {
    if (e.key === "verilens_purchase") tryUnlock();
  });
})();
