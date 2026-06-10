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
  backendUrl: document.getElementById("backendUrl"),
  backendTest: document.getElementById("backendTest"),
  backendStatus: document.getElementById("backendStatus"),
  backendPremiumNote: document.getElementById("backendPremiumNote"),
  textBackendUrl: document.getElementById("textBackendUrl"),
  textBackendTest: document.getElementById("textBackendTest"),
  textBackendStatus: document.getElementById("textBackendStatus"),
  textBackendPremiumNote: document.getElementById("textBackendPremiumNote"),
  hoverToggle: document.getElementById("hoverToggle"),
  videoMaxSeconds: document.getElementById("videoMaxSeconds"),
  upgradeCard: document.getElementById("upgradeCard"),
  premiumCard: document.getElementById("premiumCard"),
  upgradeBtn: document.getElementById("upgradeBtn"),
  resetStats: document.getElementById("resetStats"),
  statScans: document.getElementById("statScans"),
  statFacts: document.getElementById("statFacts"),
  statConfirmed: document.getElementById("statConfirmed"),
  statFiltered: document.getElementById("statFiltered"),
};

async function getState() {
  const o = await chrome.storage.local.get([
    "verilens_tier",
    "verilens_autofilter_enabled",
    "verilens_filter_categories",
    "verilens_stats",
    "verilens_backend_url",
    "verilens_text_backend_url",
    "verilens_hover_detect_enabled",
    "verilens_video_max_seconds",
  ]);
  return {
    tier: o.verilens_tier || "free",
    enabled: !!o.verilens_autofilter_enabled,
    categories: o.verilens_filter_categories || { ...DEFAULT_CATEGORIES },
    stats: o.verilens_stats || {},
    backendUrl: o.verilens_backend_url || "",
    textBackendUrl: o.verilens_text_backend_url || "",
    hoverEnabled: o.verilens_hover_detect_enabled !== false,
    videoMaxSeconds: typeof o.verilens_video_max_seconds === "number" ? o.verilens_video_max_seconds : 20,
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

  // Session stats
  const s = state.stats || {};
  els.statScans.textContent = s.deepfakeScans || 0;
  els.statFacts.textContent = s.factCheckScans || 0;
  els.statConfirmed.textContent = s.confirmedAI || 0;
  els.statFiltered.textContent = s.filteredPosts || 0;

  // Upgrade screen vs. premium-active status
  els.upgradeCard.hidden = isPremium;
  els.premiumCard.hidden = !isPremium;

  // Backend URL — don't clobber the field while the user is editing it.
  if (document.activeElement !== els.backendUrl) {
    els.backendUrl.value = state.backendUrl;
  }
  els.backendPremiumNote.hidden = isPremium;

  if (document.activeElement !== els.textBackendUrl) {
    els.textBackendUrl.value = state.textBackendUrl;
  }
  els.textBackendPremiumNote.hidden = isPremium;

  // Detection settings
  els.hoverToggle.checked = state.hoverEnabled;
  els.videoMaxSeconds.value = String(state.videoMaxSeconds);
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

els.upgradeBtn.addEventListener("click", () => {
  // Real checkout/account flow is out of scope for the mock. The dev Plan switch
  // (below) is how you actually flip to premium for testing.
  alert("Verilens Premium — checkout flow coming soon.\n\n(For testing, use Developer → Plan.)");
});

els.resetStats.addEventListener("click", async () => {
  await chrome.storage.local.set({ verilens_stats: {} });
  refresh();
});

// ---- AI Video Detection backend -------------------------------------------
function setBackendStatus(text, cls) {
  els.backendStatus.textContent = text;
  els.backendStatus.className = "vl-backend-status" + (cls ? " " + cls : "");
}

// Persist the URL as the user types (debounced) so a scan can pick it up.
let _saveTimer = null;
els.backendUrl.addEventListener("input", () => {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ verilens_backend_url: els.backendUrl.value.trim() });
  }, 300);
});

els.backendTest.addEventListener("click", async () => {
  const url = els.backendUrl.value.trim();
  await chrome.storage.local.set({ verilens_backend_url: url });
  if (!url) {
    setBackendStatus("Enter a URL first", "err");
    return;
  }
  setBackendStatus("Testing…", "");
  els.backendTest.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "PING_BACKEND", url });
    if (res && res.ok) setBackendStatus("✓ Connected · " + shortModel(res.model), "ok");
    else setBackendStatus("✗ " + ((res && res.error) || "Failed"), "err");
  } catch (e) {
    setBackendStatus("✗ " + String(e), "err");
  } finally {
    els.backendTest.disabled = false;
  }
});

// ---- AI Text Detection backend -------------------------------------------
function setTextBackendStatus(text, cls) {
  els.textBackendStatus.textContent = text;
  els.textBackendStatus.className = "vl-backend-status" + (cls ? " " + cls : "");
}

let _saveTextTimer = null;
els.textBackendUrl.addEventListener("input", () => {
  clearTimeout(_saveTextTimer);
  _saveTextTimer = setTimeout(async () => {
    await chrome.storage.local.set({ verilens_text_backend_url: els.textBackendUrl.value.trim() });
  }, 300);
});

els.textBackendTest.addEventListener("click", async () => {
  const url = els.textBackendUrl.value.trim();
  await chrome.storage.local.set({ verilens_text_backend_url: url });
  if (!url) {
    setTextBackendStatus("Enter a URL first", "err");
    return;
  }
  setTextBackendStatus("Testing…", "");
  els.textBackendTest.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "PING_TEXT_BACKEND", url });
    if (res && res.ok) setTextBackendStatus("✓ Connected · " + shortModel(res.model), "ok");
    else setTextBackendStatus("✗ " + ((res && res.error) || "Failed"), "err");
  } catch (e) {
    setTextBackendStatus("✗ " + String(e), "err");
  } finally {
    els.textBackendTest.disabled = false;
  }
});

// ---- Detection settings ----------------------------------------------------
els.hoverToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ verilens_hover_detect_enabled: els.hoverToggle.checked });
  refresh();
});

els.videoMaxSeconds.addEventListener("change", async () => {
  await chrome.storage.local.set({ verilens_video_max_seconds: Number(els.videoMaxSeconds.value) });
  refresh();
});

// vLLM reports the model as a long filesystem path; show just the last segment.
function shortModel(m) {
  if (!m) return "ready";
  const parts = String(m).split(/[\\/]/);
  return parts[parts.length - 1] || m;
}

// Keep the popup in sync if OUR settings change elsewhere (e.g. the in-page dev
// "Enable premium" link). Ignore the cache key — it changes constantly during
// classify and would cause needless re-renders.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
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
