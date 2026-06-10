// popup/popup.js
// Reads/writes the same chrome.storage.local keys the content scripts watch, so
// toggling here updates the feed live (filter.js listens via storage.onChanged).
//
// Keys:
//   verilens_tier                 "free" | "premium"
//   verilens_autofilter_enabled   boolean (master switch)
//   verilens_filter_categories    { political, ai_meme, ai_generated, misinformation }
//
// AI backend URLs (video/image) are NOT stored here and are not shown in this
// popup at all — they live in lib/config.local.js (gitignored).

const DEFAULT_CATEGORIES = {
  political: true,
  ai_meme: true,
  ai_generated: true,
  misinformation: true,
};

const els = {
  tierBadge: document.getElementById("tierBadge"),
  tabs: Array.from(document.querySelectorAll(".vl-tab")),
  panels: Array.from(document.querySelectorAll(".vl-panel")),
  autofilterToggle: document.getElementById("autofilterToggle"),
  premiumNote: document.getElementById("premiumNote"),
  categories: document.getElementById("categories"),
  catInputs: Array.from(document.querySelectorAll("[data-cat]")),
  tierToggle: document.getElementById("tierToggle"),
  tierLabel: document.getElementById("tierLabel"),
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
  dotExtract: document.getElementById("dotExtract"),
  stateExtract: document.getElementById("stateExtract"),
  dotVerify: document.getElementById("dotVerify"),
  stateVerify: document.getElementById("stateVerify"),
  devClaimText: document.getElementById("devClaimText"),
  testFactcheck: document.getElementById("testFactcheck"),
  devResult: document.getElementById("devResult"),
  historyList: document.getElementById("historyList"),
};
async function getState() {
  const o = await chrome.storage.local.get([
    "verilens_tier",
    "verilens_autofilter_enabled",
    "verilens_filter_categories",
    "verilens_stats",
    "verilens_hover_detect_enabled",
    "verilens_video_max_seconds",
    "verilens_history",
  ]);
  return {
    tier: o.verilens_tier || "free",
    enabled: !!o.verilens_autofilter_enabled,
    categories: o.verilens_filter_categories || { ...DEFAULT_CATEGORIES },
    stats: o.verilens_stats || {},
    hoverEnabled: o.verilens_hover_detect_enabled === true,
    videoMaxSeconds: typeof o.verilens_video_max_seconds === "number" ? o.verilens_video_max_seconds : 20,
    history: o.verilens_history || [],
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

  // Detection settings
  els.hoverToggle.checked = state.hoverEnabled;
  els.videoMaxSeconds.value = String(state.videoMaxSeconds);

  // History
  renderHistory(state.history);
}

var CLAIM_BAND = { corroborated: "green", contradicted: "red", unverifiable: "grey", developing: "amber" };
var CLAIM_LABEL = { corroborated: "Corroborated", contradicted: "Contradicted", unverifiable: "Unverifiable", developing: "Developing" };

function renderHistory(history) {
  if (!els.historyList) return;
  var list = history || [];
  if (!list.length) {
    els.historyList.innerHTML = '<div class="vl-history-empty">No fact-checks yet. Click "Fact-check" on any post.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < list.length; i++) {
    var h = list[i];
    var claims = h.claims || [];
    var claimHtml = claims.map(function (c) {
      var band = CLAIM_BAND[c.verdict] || "grey";
      return '<span class="vl-history-claim"><span class="vl-dot-sm ' + band + '"></span>' +
        (c.claim || "").slice(0, 80) + '</span>';
    }).join("");
    var icons = [];
    if (h.hasImage) icons.push("🖼");
    if (h.hasVideo) icons.push("🎞");
    var time = new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    html += '<div class="vl-history-item">' +
      '<div class="vl-history-meta">' + time + (icons.length ? " · " + icons.join("") : "") +
        (h.overall ? ' · <span class="vl-history-overall ' + (CLAIM_BAND[h.overall] || "grey") + '">' + h.overall.replace("_", " ") + '</span>' : "") +
      '</div>' +
      (h.caption ? '<div class="vl-history-caption">' + h.caption.slice(0, 120) + '</div>' : "") +
      (claimHtml ? '<div class="vl-history-claims">' + claimHtml + '</div>' : "") +
      (h.error ? '<div class="vl-history-error">⚠ Backend unreachable</div>' : "") +
    '</div>';
  }
  els.historyList.innerHTML = html;
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

// ---- Tabs -------------------------------------------------------------------
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    els.tabs.forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    els.panels.forEach((p) => {
      p.hidden = p.dataset.panel !== target;
    });
  });
});

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

document.getElementById("clearHistory").addEventListener("click", async () => {
  await chrome.storage.local.set({ verilens_history: [] });
  refresh();
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

// ---- Backend API pings ----------------------------------------------------
const API_BASE = "https://verilens-claim-extractor.vercel.app";
const VERIFY_BASE = "https://fact-verifier.vercel.app";

function setApiDot(el, stateEl, ok, text) {
  el.className = "vl-dot-sm " + (ok ? "green" : "red");
  stateEl.textContent = text;
}

async function pingExtract() {
  els.dotExtract.className = "vl-dot-sm amber";
  els.stateExtract.textContent = "pinging…";
  try {
    const r = await fetch(API_BASE + "/healthz", { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    setApiDot(els.dotExtract, els.stateExtract, j.ok, j.ok ? "up · " + (j.vlm_provider || "?") : "down");
  } catch { setApiDot(els.dotExtract, els.stateExtract, false, "unreachable"); }
}

async function pingVerify() {
  els.dotVerify.className = "vl-dot-sm amber";
  els.stateVerify.textContent = "pinging…";
  try {
    const r = await fetch(VERIFY_BASE + "/healthz", { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    setApiDot(els.dotVerify, els.stateVerify, j.ok, j.ok ? "up · fc=" + j.factcheck_available : "down");
  } catch { setApiDot(els.dotVerify, els.stateVerify, false, "unreachable"); }
}

document.getElementById("pingExtract").addEventListener("click", pingExtract);
document.getElementById("pingVerify").addEventListener("click", pingVerify);

// Auto-ping on popup open
pingExtract();
pingVerify();

// ---- Test fact-check ------------------------------------------------------
els.testFactcheck.addEventListener("click", async () => {
  const text = els.devClaimText.value.trim();
  if (!text) return;
  els.devResult.hidden = false;
  els.devResult.textContent = "Extracting claims…";
  els.testFactcheck.disabled = true;
  try {
    const ex = await fetch(API_BASE + "/api/factcheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "dev-test", captionText: text }),
      signal: AbortSignal.timeout(60000),
    });
    if (!ex.ok) { els.devResult.textContent = "Extract: HTTP " + ex.status; return; }
    const extract = await ex.json();
    const claims = extract.claims || [];
    if (!claims.length) { els.devResult.textContent = "No claims extracted."; return; }

    els.devResult.textContent = "Verifying " + claims.length + " claim(s)…";
    const vfy = await fetch(VERIFY_BASE + "/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "dev-test", claims: claims }),
      signal: AbortSignal.timeout(120000),
    });
    if (!vfy.ok) { els.devResult.textContent = "Verify: HTTP " + vfy.status; return; }
    const verify = await vfy.json();
    els.devResult.textContent = JSON.stringify(verify, null, 2);
  } catch (e) {
    els.devResult.textContent = "Error: " + (e.message || e);
  } finally {
    els.testFactcheck.disabled = false;
  }
});

refresh();
