// popup/popup.js
// Reads/writes the same chrome.storage.local keys the content scripts watch, so
// toggling here updates the feed live (filter.js listens via storage.onChanged).
//
// Keys:
//   verilens_scanning_enabled     boolean (master switch for ALL extension activity)
//   verilens_tier                 "free" | "premium"
//   verilens_autofilter_enabled   boolean (master switch for auto-hiding posts)
//   verilens_filter_categories    { political, ai_meme, ai_generated, misinformation }
//

const WEBSITE_URL = "http://localhost:8000/website/index.html";

const DEFAULT_CATEGORIES = {
  political: true,
  ai_meme: true,
  ai_generated: true,
  misinformation: true,
};

const els = {
  // Headers & Views
  btnOpenSettings: document.getElementById("btnOpenSettings"),
  btnBack: document.getElementById("btnBack"),
  mainHeader: document.getElementById("mainHeader"),
  settingsHeader: document.getElementById("settingsHeader"),
  viewMain: document.getElementById("viewMain"),
  viewSettings: document.getElementById("viewSettings"),
  
  // Master Switch
  masterToggleBtn: document.getElementById("masterToggleBtn"),
  masterStatusText: document.getElementById("masterStatusText"),
  
  // Dashboard Elements
  hoverToggle: document.getElementById("hoverToggle"),
  upgradePromoCard: document.getElementById("upgradePromoCard"),
  btnViewDashboard: document.getElementById("btnViewDashboard"),
  
  // Settings Elements
  tierBadge: document.getElementById("tierBadge"),
  autofilterToggle: document.getElementById("autofilterToggle"),
  premiumNote: document.getElementById("premiumNote"),
  categories: document.getElementById("categories"),
  catInputs: Array.from(document.querySelectorAll("[data-cat]")),
  tierToggle: document.getElementById("tierToggle"),
  tierLabel: document.getElementById("tierLabel"),
  videoMaxSeconds: document.getElementById("videoMaxSeconds"),
  
  // Stats
  resetStats: document.getElementById("resetStats"),
  statScans: document.getElementById("statScans"),
  statFacts: document.getElementById("statFacts"),
  statConfirmed: document.getElementById("statConfirmed"),
  statFiltered: document.getElementById("statFiltered"),
};

async function getState() {
  const o = await chrome.storage.local.get([
    "verilens_scanning_enabled",
    "verilens_tier",
    "verilens_autofilter_enabled",
    "verilens_filter_categories",
    "verilens_stats",
    "verilens_hover_detect_enabled",
    "verilens_video_max_seconds",
  ]);
  return {
    scanningEnabled: o.verilens_scanning_enabled !== false, // Default to true if not set
    tier: o.verilens_tier || "free",
    autofilterEnabled: !!o.verilens_autofilter_enabled,
    categories: o.verilens_filter_categories || { ...DEFAULT_CATEGORIES },
    stats: o.verilens_stats || {},
    hoverEnabled: o.verilens_hover_detect_enabled === true,
    videoMaxSeconds: typeof o.verilens_video_max_seconds === "number" ? o.verilens_video_max_seconds : 20,
  };
}

function render(state) {
  const isPremium = state.tier === "premium";

  // Master Switch
  els.masterToggleBtn.classList.toggle("active", state.scanningEnabled);
  els.masterStatusText.textContent = state.scanningEnabled ? "SCANNING ACTIVE" : "ENABLE SCANNING";
  els.masterStatusText.style.color = state.scanningEnabled ? "#1d9bf0" : "#e7e9ea";

  // Tier Badge
  els.tierBadge.textContent = state.tier;
  els.tierBadge.classList.toggle("premium", isPremium);
  
  // Dashboard
  els.hoverToggle.checked = state.hoverEnabled;
  els.upgradePromoCard.hidden = isPremium;

  // Settings
  els.tierToggle.checked = isPremium;
  els.tierLabel.textContent = isPremium ? "Premium" : "Free";

  els.autofilterToggle.checked = isPremium && state.autofilterEnabled;
  els.autofilterToggle.disabled = !isPremium;
  els.premiumNote.hidden = isPremium;

  const catsActive = isPremium && state.autofilterEnabled;
  els.categories.classList.toggle("vl-disabled", !catsActive);
  els.catInputs.forEach((input) => {
    const cat = input.dataset.cat;
    input.checked = state.categories[cat] !== false;
    input.disabled = !catsActive;
  });

  els.videoMaxSeconds.value = String(state.videoMaxSeconds);

  // Stats
  const s = state.stats || {};
  els.statScans.textContent = s.deepfakeScans || 0;
  els.statFacts.textContent = s.factCheckScans || 0;
  els.statConfirmed.textContent = s.confirmedAI || 0;
  els.statFiltered.textContent = s.filteredPosts || 0;
}

async function refresh() {
  render(await getState());
}

// ---- Navigation ------------------------------------------------------------
els.btnOpenSettings.addEventListener("click", () => {
  els.mainHeader.hidden = true;
  els.viewMain.hidden = true;
  els.settingsHeader.hidden = false;
  els.viewSettings.hidden = false;
});

els.btnBack.addEventListener("click", () => {
  els.settingsHeader.hidden = true;
  els.viewSettings.hidden = true;
  els.mainHeader.hidden = false;
  els.viewMain.hidden = false;
});

els.btnViewDashboard.addEventListener("click", () => {
  chrome.tabs.create({ url: WEBSITE_URL });
});

// ---- Wiring Toggles --------------------------------------------------------

// Master Power Button
els.masterToggleBtn.addEventListener("click", async () => {
  const { scanningEnabled } = await getState();
  await chrome.storage.local.set({ verilens_scanning_enabled: !scanningEnabled });
  refresh();
});

// Dashboard Quick Toggles
els.hoverToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ verilens_hover_detect_enabled: els.hoverToggle.checked });
  refresh();
});

// Settings Toggles
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

els.videoMaxSeconds.addEventListener("change", async () => {
  await chrome.storage.local.set({ verilens_video_max_seconds: Number(els.videoMaxSeconds.value) });
  refresh();
});

els.resetStats.addEventListener("click", async () => {
  await chrome.storage.local.set({ verilens_stats: {} });
  refresh();
});

// ---- Sync with storage -----------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.verilens_scanning_enabled ||
    changes.verilens_tier ||
    changes.verilens_autofilter_enabled ||
    changes.verilens_filter_categories ||
    changes.verilens_stats ||
    changes.verilens_hover_detect_enabled ||
    changes.verilens_video_max_seconds
  ) {
    refresh();
  }
});

refresh();
