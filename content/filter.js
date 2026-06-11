// content/filter.js
// The AUTOMATIC content filter — the ONLY feature that runs without a click.
//
// Design (v2, viewport-driven):
//   - We do NOT classify the whole feed. We classify a post the first time it
//     scrolls into view, once, then cache it. This is the genuinely "cheap"
//     path: no repeated full-DOM scans, and the worker only hears about posts
//     the user actually sees.
//   - A lightweight MutationObserver only DISCOVERS new <article>s and hands
//     them to an IntersectionObserver. No network, no hashing happens there.
//   - The IntersectionObserver fires when a post nears the viewport; we batch
//     those, send ONE /classify, and blur matches in place.
//
//   PREMIUM + autoFilter-enabled only; otherwise dormant. The worker is still
//   the authoritative tier gate.
(function (g) {
  const Tiers = g.VerilensTiers;

  const CATEGORY_LABEL = {
    political: "Political",
    ai_meme: "AI meme",
    ai_generated: "AI-generated",
    misinformation: "Misinformation",
  };

  let adapter = null;
  let mo = null; // discovery (finds new articles)
  let io = null; // visibility (classify on view)
  let running = false;
  let currentState = null;

  const filtered = new Set(); // postEls we've blurred (for teardown)
  const registered = new Set(); // postEls handed to the IntersectionObserver
  let queue = new Set(); // visible postEls awaiting classify
  let queueTimer = null;

  function alive() {
    return !!(g.chrome && chrome.runtime && chrome.runtime.id);
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  const DEAD_STATE = { tier: "free", enabled: false, categories: {} };
  async function getState() {
    if (!alive()) return DEAD_STATE;
    try {
      const o = await chrome.storage.local.get([
        "verilens_scanning_enabled",
        "verilens_tier",
        "verilens_autofilter_enabled",
        "verilens_filter_categories",
      ]);
      return {
        tier: o.verilens_tier || "free",
        enabled: o.verilens_scanning_enabled !== false && !!o.verilens_autofilter_enabled,
        categories: o.verilens_filter_categories || {},
      };
    } catch (e) {
      return DEAD_STATE;
    }
  }

  function enabledCategories(state) {
    return Object.keys(state.categories).filter((k) => state.categories[k]);
  }

  // ---- blur / reveal -------------------------------------------------------
  function blurPost(postEl, matchedLabels, provenance) {
    if (!alive()) return;
    if (postEl.dataset.verilensFilter === "blurred") return;
    postEl.dataset.verilensFilter = "blurred";

    if (getComputedStyle(postEl).position === "static") {
      postEl.style.position = "relative";
    }

    // Blur the post's real content (every existing child), but NOT our overlay —
    // a CSS filter applies to an element AND its descendants, so the overlay
    // must be a sibling appended afterwards.
    Array.from(postEl.children).forEach((child) => {
      child.style.filter = "blur(12px)";
      child.style.pointerEvents = "none";
      child.style.userSelect = "none";
    });

    const host = el("div", "verilens-filter-host");
    host.style.all = "initial";
    const root = host.attachShadow({ mode: "open" });
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content/styles.css");
    root.append(link);

    const overlay = el("div", "verilens-filter-overlay");
    const labels = matchedLabels.map((l) => CATEGORY_LABEL[l] || l).join(", ");
    overlay.append(el("div", "verilens-filter-badge", "🛡 Hidden by Verilens"));
    overlay.append(el("div", "verilens-filter-cats", labels));
    // Local C2PA proof → say it's confirmed, not just classified.
    if (provenance === "c2pa") {
      overlay.append(el("div", "verilens-filter-conf", "✓ Confirmed AI · C2PA"));
    }
    const showBtn = el("button", "verilens-filter-show", "Show anyway");
    showBtn.addEventListener("click", () => revealPost(postEl));
    overlay.append(showBtn);
    root.append(overlay);

    postEl.appendChild(host);
    filtered.add(postEl);
    bumpFilteredStat();
  }

  // Session stat: count posts actually hidden by the filter.
  function bumpFilteredStat() {
    if (!alive()) return;
    chrome.storage.local.get("verilens_stats").then((o) => {
      const s = o.verilens_stats || {};
      s.filteredPosts = (s.filteredPosts || 0) + 1;
      chrome.storage.local.set({ verilens_stats: s });
    });
  }

  function revealPost(postEl) {
    Array.from(postEl.children).forEach((child) => {
      if (child.classList && child.classList.contains("verilens-filter-host")) {
        child.remove();
        return;
      }
      child.style.filter = "";
      child.style.pointerEvents = "";
      child.style.userSelect = "";
    });
    postEl.dataset.verilensFilter = "revealed";
    filtered.delete(postEl);
  }

  function teardownAll() {
    filtered.forEach((postEl) => revealPost(postEl));
    filtered.clear();
    registered.clear();
    document
      .querySelectorAll("[data-verilens-filter]")
      .forEach((e) => delete e.dataset.verilensFilter);
  }

  // ---- discovery: hand new posts to the IntersectionObserver ---------------
  // Twitter/IG use <article>; Facebook uses <div role="article">.
  const POST_SEL = 'article, [role="article"]';
  function addsArticles(mutations) {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if ((n.matches && n.matches(POST_SEL)) || (n.querySelector && n.querySelector(POST_SEL))) {
          return true;
        }
      }
    }
    return false;
  }

  function registerNew() {
    if (!alive() || !io) return;
    for (const postEl of adapter.findPosts()) {
      if (registered.has(postEl)) continue;
      if (postEl.dataset.verilensFilter) continue; // already handled
      registered.add(postEl);
      io.observe(postEl);
    }
  }

  // ---- visibility → batched classify ---------------------------------------
  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const postEl = e.target;
      if (io) io.unobserve(postEl); // classify once; don't watch forever
      if (postEl.dataset.verilensFilter) continue;
      queue.add(postEl);
    }
    if (queue.size) scheduleFlush();
  }

  function scheduleFlush() {
    if (queueTimer) return;
    queueTimer = setTimeout(() => {
      queueTimer = null;
      flushQueue().catch(() => {});
    }, 300);
  }

  async function flushQueue() {
    if (!alive()) {
      stop();
      return;
    }
    const state = currentState || (await getState());
    if (!state.enabled) return;
    const cats = enabledCategories(state);

    const posts = Array.from(queue);
    queue = new Set();
    if (!cats.length || !posts.length) return;

    const batch = [];
    const byId = new Map();
    for (const postEl of posts) {
      if (postEl.dataset.verilensFilter) continue;
      const data = adapter.extractPostData(postEl);
      const id = data.postId || "h:" + data.contentHash;
      postEl.dataset.verilensFilter = "pending";
      byId.set(id, postEl);
      batch.push({
        postId: id,
        contentHash: data.contentHash,
        captionText: data.captionText,
        imageUrls: data.imageUrls,
      });
    }
    if (!batch.length) return;

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "CLASSIFY", payload: { posts: batch } });
    } catch (e) {
      res = { results: [] };
    }

    const results = (res && res.results) || [];
    const seen = new Set();
    for (const r of results) {
      seen.add(r.postId);
      const postEl = byId.get(r.postId);
      if (!postEl) continue;
      const matched = (r.labels || []).filter((l) => state.categories[l]);
      if (matched.length) blurPost(postEl, matched, r.provenance);
      else postEl.dataset.verilensFilter = "clean";
    }
    byId.forEach((postEl, id) => {
      if (!seen.has(id) && postEl.dataset.verilensFilter === "pending") {
        delete postEl.dataset.verilensFilter;
      }
    });
  }

  // ---- lifecycle -----------------------------------------------------------
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function start(state) {
    if (running) return;
    running = true;
    currentState = state;

    // rootMargin pre-classifies posts ~a screen before they're fully in view,
    // so the blur is already in place by the time you reach them.
    io = new IntersectionObserver(onIntersect, { rootMargin: "300px 0px", threshold: 0.01 });

    const debouncedRegister = debounce(registerNew, 300);
    mo = new MutationObserver((mutations) => {
      if (addsArticles(mutations)) debouncedRegister();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    registerNew();
  }

  function stop() {
    if (mo) mo.disconnect();
    if (io) io.disconnect();
    mo = null;
    io = null;
    running = false;
    if (queueTimer) {
      clearTimeout(queueTimer);
      queueTimer = null;
    }
    queue = new Set();
    teardownAll();
  }

  // Read settings and (re)start or stop. Called on init and on any settings
  // change so category/tier/master toggles take effect immediately.
  async function sync() {
    if (!adapter) return;
    const state = await getState();
    stop(); // always reset to a clean slate
    const shouldRun =
      Tiers.isAllowed("autoFilter", state.tier) && state.enabled && enabledCategories(state).length > 0;
    if (shouldRun) start(state);
  }

  function init(platformAdapter) {
    if (!alive()) return;
    adapter = platformAdapter;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (
        changes.verilens_scanning_enabled ||
        changes.verilens_tier ||
        changes.verilens_autofilter_enabled ||
        changes.verilens_filter_categories
      ) {
        sync().catch(() => {});
      }
    });
    sync().catch(() => {});
  }

  g.VerilensFilter = { init };
})(globalThis);
