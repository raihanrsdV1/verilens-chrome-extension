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

  // Pick the adapter for the current site. x.com and twitter.com share the
  // Twitter DOM, so they map to the same adapter.
  function pickAdapter() {
    const h = location.hostname;
    if (h.endsWith("x.com") || h.endsWith("twitter.com")) return Adapters.twitter;
    if (h.endsWith("instagram.com")) return Adapters.instagram;
    if (h.endsWith("facebook.com")) return Adapters.facebook;
    return null;
  }

  const adapter = pickAdapter();
  if (!adapter) return;

  function processPost(postEl) {
    if (postEl.dataset.verilens) return; // already handled

    const data = adapter.extractPostData(postEl);

    // Attach if there's anything to act on: media (image/video) enables the
    // deepfake button; text enables fact-check. Skip only truly empty posts.
    const hasMedia = data && (data.imageUrls.length > 0 || data.hasVideo);
    const hasText = data && (data.captionText || "").trim().length > 0;
    if (!data || (!hasMedia && !hasText)) {
      postEl.dataset.verilens = "skip";
      return;
    }

    postEl.dataset.verilens = "done";
    const anchor = adapter.getActionAnchor(postEl);
    // attach() is async and fire-and-forget; swallow any rejection (e.g. the
    // context dying mid-attach) so it never surfaces as an uncaught rejection.
    Promise.resolve(window.VerilensActions.attach(postEl, data, anchor)).catch(() => {});
  }

  // If the extension was reloaded, this content script is orphaned — stop
  // observing so we don't keep throwing "context invalidated".
  function alive() {
    return !!(window.chrome && chrome.runtime && chrome.runtime.id);
  }

  function scan() {
    if (!alive()) {
      observer.disconnect();
      return;
    }
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

  // X fires a LOT of DOM mutations while scrolling; most have nothing to do with
  // new posts. Only bother scanning when a mutation actually adds article-like
  // nodes — this keeps the observer cheap and the feed smooth.
  // Twitter/IG use <article>; Facebook uses <div role="article">. Match both,
  // or FB never re-scans as posts stream in.
  const POST_SEL = 'article, [role="article"]';
  function addsArticles(mutations) {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue; // elements only
        if ((n.matches && n.matches(POST_SEL)) || (n.querySelector && n.querySelector(POST_SEL))) {
          return true;
        }
      }
    }
    return false;
  }

  // X is a single-page app that streams posts in as you scroll, so we watch the
  // DOM and re-scan. (Button injection only — no network.)
  const observer = new MutationObserver((mutations) => {
    if (addsArticles(mutations)) debouncedScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  scan(); // initial pass for whatever's already on screen

  // Start the AUTOMATIC content filter (premium). It self-gates on tier +
  // settings and runs its OWN observer; for free users it stays dormant.
  if (window.VerilensFilter) {
    window.VerilensFilter.init(adapter);
  }
})();
