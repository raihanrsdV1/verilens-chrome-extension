// content/content.js
// Entry point injected into X/Twitter pages. It finds posts and attaches our
// per-post control bar.
//
// IMPORTANT distinction (per the product spec):
//   - This MutationObserver only ATTACHES BUTTONS. It performs NO network calls
//     and runs NO classifier. It's cheap DOM bookkeeping.
//   - The expensive deepfake scan is MANUAL — it only fires when the user clicks
//     "Check media".
//   - The AUTOMATIC content-filter MutationObserver (premium, classify path) is
//     a separate thing arriving in M3, not here.
(function () {
  const Adapters = window.VerilensAdapters || {};
  // x.com and twitter.com share the same DOM → same adapter.
  const adapter = Adapters.twitter;
  if (!adapter) return;

  function processPost(postEl) {
    if (postEl.dataset.verilens) return; // already handled

    const data = adapter.extractPostData(postEl);

    // M1 = image deepfake only. Skip posts with no analyzable image so we don't
    // clutter every text-only tweet with a button.
    if (!data || data.imageUrls.length === 0) {
      postEl.dataset.verilens = "skip";
      return;
    }

    postEl.dataset.verilens = "done";
    const anchor = adapter.getActionAnchor(postEl);
    window.VerilensActions.attach(postEl, data, anchor);
  }

  function scan() {
    adapter.findPosts().forEach(processPost);
  }

  // Simple debounce so a burst of DOM mutations triggers one scan.
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  const debouncedScan = debounce(scan, 300);

  // X is a single-page app that streams posts in as you scroll, so we watch the
  // DOM and re-scan. (Button injection only — no network.)
  const observer = new MutationObserver(debouncedScan);
  observer.observe(document.body, { childList: true, subtree: true });

  scan(); // initial pass for whatever's already on screen
})();
