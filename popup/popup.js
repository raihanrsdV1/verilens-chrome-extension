// popup/popup.js
// Reads/writes the same chrome.storage.local keys the content scripts watch, so
// toggling here updates the feed live (filter.js listens via storage.onChanged).
//
// Keys:
//   verilens_tier                 "free" | "premium"
//   verilens_autofilter_enabled   boolean (master switch)
//   verilens_filter_categories    { political, ai_meme, ai_generated, misinformation }

const DEFAULT_CATEGORIES = {
  political: true,
  ai_meme: true,
  ai_generated: true,
  misinformation: true,
};

const els = {
  tierBadge: document.getElementById("tierBadge"),
  autofilterToggle: document.getElementById("autofilterToggle"),
  premiumNote: document.getElementById("premiumNote"),
  categories: document.getElementById("categories"),
  catInputs: Array.from(document.querySelectorAll("[data-cat]")),
  tierToggle: document.getElementById("tierToggle"),
  tierLabel: document.getElementById("tierLabel"),
};

async function getState() {
  const o = await chrome.storage.local.get([
    "verilens_tier",
    "verilens_autofilter_enabled",
    "verilens_filter_categories",
  ]);
  return {
    tier: o.verilens_tier || "free",
    enabled: !!o.verilens_autofilter_enabled,
    categories: o.verilens_filter_categories || { ...DEFAULT_CATEGORIES },
  };
}

function render(state) {
  const isPremium = state.tier === "premium";

  els.tierBadge.textContent = state.tier;
  els.tierBadge.classList.toggle("premium", isPremium);

  els.tierToggle.checked = isPremium;
  els.tierLabel.textContent = isPremium ? "Premium" : "Free";

  // Auto-filter is premium-only. On free, force the master switch off + locked.
  els.autofilterToggle.checked = isPremium && state.enabled;
  els.autofilterToggle.disabled = !isPremium;
  els.premiumNote.hidden = isPremium;

  const catsActive = isPremium && state.enabled;
  els.categories.classList.toggle("vl-disabled", !catsActive);
  els.catInputs.forEach((input) => {
    const cat = input.dataset.cat;
    input.checked = state.categories[cat] !== false;
    input.disabled = !catsActive;
  });
}

// Timing probe: how long from this script starting to the first full render.
// If this prints a small number (e.g. < 50 ms) but the WINDOW still felt slow
// to appear, the delay is Chrome creating the popup process — not our code.
const _t0 = performance.now();
let _timedFirstRender = false;

async function refresh() {
  render(await getState());
  if (!_timedFirstRender) {
    _timedFirstRender = true;
    console.log("[Verilens popup] ready in", Math.round(performance.now() - _t0), "ms");
  }
}

// ---- wiring ----------------------------------------------------------------
els.tierToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({
    verilens_tier: els.tierToggle.checked ? "premium" : "free",
  });
  refresh();
});

els.autofilterToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ verilens_autofilter_enabled: els.autofilterToggle.checked });
  refresh();
});

els.catInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    const { categories } = await getState();
    categories[input.dataset.cat] = input.checked;
    await chrome.storage.local.set({ verilens_filter_categories: categories });
    refresh();
  });
});

// Keep the popup in sync if OUR settings change elsewhere (e.g. the in-page dev
// "Enable premium" link). Ignore the cache key — it changes constantly during
// classify and would cause needless re-renders.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.verilens_tier ||
    changes.verilens_autofilter_enabled ||
    changes.verilens_filter_categories
  ) {
    refresh();
  }
});

refresh();
