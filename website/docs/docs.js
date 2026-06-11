// website/docs/docs.js
// Public /docs renderer: access gate → render pitch + technical + live system view.
// Reads DEFAULTS from content.js (window.VerilensDocs) and merges a localStorage
// overlay written by the admin panel. No framework — plain DOM string-building.
(function () {
  "use strict";

  const DEFAULTS = window.VerilensDocs;
  const OVERRIDE_KEY = "verilens_docs_overrides";
  const DRAFT_KEY = "verilens_docs_draft";
  const THEME_KEY = "verilens_site_theme";

  // Preview mode (admin "Preview ↗" opens ?preview=1) layers the unpublished
  // draft on top and bypasses the access gate — only for whoever has the link.
  const PREVIEW = /[?&]preview=1\b/.test(location.search);

  // ── config merge ───────────────────────────────────────────────────────────
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function deepMerge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k in over) {
      if (isObj(out[k]) && isObj(over[k])) out[k] = deepMerge(out[k], over[k]);
      else out[k] = over[k]; // arrays + primitives replace
    }
    return out;
  }
  function effectiveConfig() {
    let cfg = DEFAULTS;
    try {
      const over = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "null");
      if (over) cfg = deepMerge(cfg, over);
      if (PREVIEW) {
        const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
        if (draft) cfg = deepMerge(cfg, draft);
      }
    } catch (e) {}
    return cfg;
  }

  const CFG = effectiveConfig();

  // ── helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function el(id) { return document.getElementById(id); }
  function fmtDate(s) {
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  // ── THEME ──────────────────────────────────────────────────────────────────
  const root = document.documentElement;
  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  function applyTheme(t) {
    root.setAttribute("data-theme", t);
    const b = el("themeToggle");
    if (b) b.innerHTML = t === "dark" ? ICON_SUN : ICON_MOON;
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");

  // ── ACCESS GATE ────────────────────────────────────────────────────────────
  function accessState() {
    const a = CFG.access || {};
    if (!a.enabled) return { ok: false, title: "Not Available", msg: "This documentation is currently turned off by the administrator." };
    if (a.useSchedule) {
      const now = Date.now();
      const start = a.start ? new Date(a.start).getTime() : -Infinity;
      const end = a.end ? new Date(a.end).getTime() : Infinity;
      if (now < start) return { ok: false, title: "Not Yet Available", msg: "This documentation opens on " + fmtDate(a.start) + "." };
      if (now > end) return { ok: false, title: "Window Closed", msg: "This documentation was available until " + fmtDate(a.end) + "." };
    }
    return { ok: true };
  }

  function showGate(state) {
    el("gateScreen").hidden = false;
    el("docsApp").hidden = true;
    el("gateTitle").textContent = state.title;
    el("gateMsg").textContent = state.msg;
  }

  // ── SECTION REGISTRY (drives TOC groups + render order) ─────────────────────
  // group → list of { id, label, render() } sections.
  function buildSections() {
    const S = [];

    // -- PITCH DECK --
    (CFG.pitch || []).forEach((p) => {
      S.push({
        group: "Pitch Deck", id: p.id, label: p.title,
        html: `<div class="pitch-card"><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p></div>`,
      });
    });

    // Team
    S.push({ group: "Pitch Deck", id: "team", label: "Team", html: renderTeam() });

    // -- TECHNICAL --
    S.push({ group: "Product", id: "overview", label: "Product Overview", html: renderOverview() });
    S.push({ group: "Product", id: "features", label: "Feature Matrix", html: renderFeatures() });
    S.push({ group: "Architecture", id: "architecture", label: "Architecture", html: renderDiagram("Architecture", CFG.diagrams.architecture, "arch") });
    S.push({ group: "Architecture", id: "dataflow", label: "Data Flow", html: renderDiagram("Data Flow", CFG.diagrams.dataflow, "flow") });
    S.push({ group: "Architecture", id: "stack", label: "Technology Stack", html: renderStack() });
    S.push({ group: "Engineering", id: "apis", label: "API Documentation", html: renderApis() });
    S.push({ group: "Engineering", id: "data-layer", label: "Data Layer", html: renderDefBlock(CFG.dataLayer, { sources: "Data sources", storage: "Storage", privacy: "Privacy" }) });
    S.push({ group: "Engineering", id: "ai-layer", label: "AI Layer", html: renderDefBlock(CFG.aiLayer, { models: "Models", personalization: "Personalization", explainability: "Explainability" }) });
    S.push({ group: "Operations", id: "roadmap", label: "Product Roadmap", html: renderRoadmap() });
    S.push({ group: "Operations", id: "performance", label: "Performance & Scalability", html: renderDefBlock(CFG.performance, { load: "Load expectations", optimization: "Optimization strategy" }) });
    S.push({ group: "Operations", id: "security", label: "Security", html: renderDefBlock(CFG.security, { auth: "Auth", rbac: "RBAC", dataProtection: "Data protection" }) });
    S.push({ group: "Operations", id: "analytics", label: "Analytics", html: renderAnalytics() });
    S.push({ group: "Operations", id: "changelog", label: "Changelog", html: renderChangelog() });

    return S;
  }

  // ── SECTION RENDERERS ───────────────────────────────────────────────────────
  function renderTeam() {
    const t = CFG.team || { members: [] };
    const cards = (t.members || []).map((m) => {
      const initials = (m.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      const hue = Math.abs(hashStr(m.name || "")) % 360;
      const avatar = m.photo
        ? `<img class="team-avatar" src="${esc(m.photo)}" alt="${esc(m.name)}" />`
        : `<div class="team-avatar" style="background:hsl(${hue} 60% 45%)">${esc(initials)}</div>`;
      const email = m.email ? `<div class="t-email"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div>` : "";
      return `<div class="team-card">${avatar}<div class="t-name">${esc(m.name)}</div><div class="t-role">${esc(m.role || "")}</div>${email}</div>`;
    }).join("");
    const teamName = t.name ? `<p class="docs-prose dim">${esc(t.name)}</p>` : "";
    return teamName + `<div class="team-grid">${cards || '<p class="docs-prose dim">No team members yet.</p>'}</div>`;
  }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0; return h; }

  function renderOverview() {
    const o = CFG.overview || {};
    const cases = (o.useCases || []).map((c) => `<li>${esc(c)}</li>`).join("");
    return `
      <p class="docs-prose">${esc(o.what)}</p>
      <div class="docs-cols">
        <div class="docs-block def"><h4>Target users</h4><p>${esc(o.targetUsers)}</p></div>
        <div class="docs-block"><h4>Core use cases</h4><ul>${cases}</ul></div>
      </div>`;
  }

  function renderFeatures() {
    const rows = (CFG.features || []).map((f) => {
      const tierCls = f.tier === "Pro" ? "pro" : "free";
      const stCls = f.status === "live" ? "live" : f.status === "upcoming" ? "upcoming" : "planned";
      return `<tr>
        <td><strong>${esc(f.name)}</strong></td>
        <td><span class="badge ${tierCls}">${esc(f.tier)}</span></td>
        <td><span class="badge ${stCls}">${esc(f.status)}</span></td>
        <td class="docs-prose dim" style="margin:0;font-size:13px">${esc(f.note)}</td>
      </tr>`;
    }).join("");
    return `<p class="docs-prose dim">Tier boundary mirrors <span class="mono">lib/tiers.js</span> — the single source of truth enforced in the service worker.</p>
      <div class="docs-table-wrap"><table class="docs-table">
        <thead><tr><th>Capability</th><th>Tier</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  function renderDiagram(title, src, key) {
    return `<p class="docs-kicker">Rendered with Mermaid · editable in admin</p>
      <div class="mermaid-wrap"><div class="mermaid" data-diagram="${key}">${esc(src)}</div>
      <div class="diagram-fallback" data-fallback="${key}" hidden>Diagram engine unavailable — source:<pre>${esc(src)}</pre></div></div>`;
  }

  function renderStack() {
    const cols = Object.keys(CFG.stack || {}).map((cat) => {
      const items = CFG.stack[cat].map((i) => `<li>${esc(i)}</li>`).join("");
      return `<div class="docs-block"><h4>${esc(cat)}</h4><ul>${items}</ul></div>`;
    }).join("");
    return `<div class="docs-cols">${cols}</div>`;
  }

  function renderApis() {
    const a = CFG.apis || {};
    const consumed = (a.consumed || []).map((x) => `
      <div class="kv-row">
        <div class="k">${esc(x.name)}</div>
        <div class="v mono">${esc(x.endpoint)}</div>
        <div class="v"><strong>I/O:</strong> ${esc(x.io)} &nbsp;·&nbsp; <strong>Auth:</strong> ${esc(x.auth)}</div>
      </div>`).join("");
    const internal = (a.internal || []).map((x) =>
      `<div class="kv-row"><div class="k mono">${esc(x.type)}</div><div class="v">${esc(x.desc)}</div></div>`).join("");
    return `
      <p class="docs-kicker">APIs the extension consumes</p>
      <div class="kv">${consumed}</div>
      <p class="docs-kicker" style="margin-top:22px">Internal message contracts (service-worker router)</p>
      <div class="kv">${internal}</div>`;
  }

  function renderDefBlock(obj, labels) {
    const blocks = Object.keys(labels || {}).map((k) =>
      `<div class="docs-block def"><h4>${esc(labels[k])}</h4><p>${esc(obj[k])}</p></div>`).join("");
    return `<div class="docs-cols">${blocks}</div>`;
  }

  function renderRoadmap() {
    const r = CFG.roadmap || {};
    const col = (title, arr) => `<div class="roadmap-col"><h4>${title}</h4><ul>${(arr || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
    return `<div class="roadmap-grid">${col("Short term", r.short)}${col("Mid term", r.mid)}${col("Long term", r.long)}</div>`;
  }

  function renderAnalytics() {
    const a = CFG.analytics || {};
    const kpis = (a.kpis || []).map((k) => `<li>${esc(k)}</li>`).join("");
    return `<div class="docs-cols">
      <div class="docs-block"><h4>Key metrics (KPIs)</h4><ul>${kpis}</ul></div>
      <div class="docs-block def"><h4>How it's measured</h4><p>${esc(a.metricsNote)}</p></div>
    </div>`;
  }

  function renderChangelog() {
    return (CFG.changelog || []).map((c) => `
      <div class="changelog-entry">
        <div class="cl-head"><span class="cl-ver">v${esc(c.version)}</span><span class="cl-date">${esc(c.date)}</span></div>
        <ul>${(c.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      </div>`).join("");
  }

  // ── MOUNT ───────────────────────────────────────────────────────────────────
  const SECTIONS = buildSections();

  function mount() {
    el("docsApp").hidden = false;
    el("gateScreen").hidden = true;

    // Hero
    el("brandName").textContent = CFG.product.name;
    el("heroTitle").textContent = CFG.product.name;
    el("heroSub").textContent = CFG.product.oneLiner;

    // TOC (grouped)
    const groups = [];
    SECTIONS.forEach((s) => {
      let g = groups.find((x) => x.name === s.group);
      if (!g) { g = { name: s.group, items: [] }; groups.push(g); }
      g.items.push(s);
    });
    el("tocNav").innerHTML = groups.map((g) =>
      `<div class="docs-toc-group">${esc(g.name)}</div>` +
      g.items.map((s) => `<a href="#${s.id}" data-toc="${s.id}">${esc(s.label)}</a>`).join("")
    ).join("");

    // Sections
    let n = 0;
    el("sectionsRoot").innerHTML = SECTIONS.map((s) => {
      n++;
      return `<section class="docs-section" id="${s.id}">
        <h2><span class="num">${String(n).padStart(2, "0")}</span>${esc(s.label)}</h2>
        ${s.html}
      </section>`;
    }).join("");

    el("footMeta").textContent = CFG.product.name + " · " + (CFG.team && CFG.team.name ? CFG.team.name : "") ;

    wireNav();
    wireSearch();
    wireExports();
    renderLiveStatus();
    initDiagrams();
    scrollSpy();
  }

  // ── NAV (mobile + scrollspy) ────────────────────────────────────────────────
  function wireNav() {
    const sidebar = el("docsSidebar");
    el("navToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
    el("themeToggle").addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
      reRenderDiagrams(); // mermaid needs re-theming
    });
    document.querySelectorAll("[data-toc]").forEach((a) =>
      a.addEventListener("click", () => sidebar.classList.remove("open")));
  }

  function scrollSpy() {
    const links = Array.from(document.querySelectorAll("[data-toc]"));
    const map = new Map(links.map((l) => [l.getAttribute("data-toc"), l]));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          links.forEach((l) => l.classList.remove("active"));
          const a = map.get(e.target.id);
          if (a) a.classList.add("active");
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    SECTIONS.forEach((s) => { const node = el(s.id); if (node) obs.observe(node); });
  }

  // ── SEARCH ──────────────────────────────────────────────────────────────────
  function wireSearch() {
    const input = el("searchInput");
    const box = el("searchResults");
    const index = SECTIONS.map((s) => ({
      id: s.id, label: s.label, group: s.group,
      text: (el(s.id) ? el(s.id).textContent : "").toLowerCase(),
    }));

    function run() {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.hidden = true; return; }
      const hits = index.filter((x) => x.label.toLowerCase().includes(q) || x.text.includes(q)).slice(0, 8);
      box.hidden = false;
      box.innerHTML = hits.length
        ? hits.map((h) => {
            const i = h.text.indexOf(q);
            const snippet = i >= 0 ? "…" + h.text.slice(Math.max(0, i - 30), i + 50).trim() + "…" : "";
            return `<a href="#${h.id}" data-jump="${h.id}">${esc(h.label)} <small>${esc(h.group)}${snippet ? " · " + esc(snippet) : ""}</small></a>`;
          }).join("")
        : '<div class="docs-search-empty">No matches</div>';
      box.querySelectorAll("[data-jump]").forEach((a) =>
        a.addEventListener("click", () => { box.hidden = true; input.value = ""; }));
    }
    input.addEventListener("input", run);
    input.addEventListener("focus", run);
    document.addEventListener("click", (e) => { if (!e.target.closest(".docs-search")) box.hidden = true; });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); }
      if (e.key === "Escape") { box.hidden = true; input.blur(); }
    });
  }

  // ── EXPORTS ─────────────────────────────────────────────────────────────────
  function wireExports() {
    el("exportPdf").addEventListener("click", () => window.print());
    el("shareLink").addEventListener("click", async () => {
      const url = location.href.split("#")[0];
      try { await navigator.clipboard.writeText(url); flash(el("shareLink"), "Copied!"); }
      catch (e) { prompt("Copy this link:", url); }
    });
    el("exportMd").addEventListener("click", () => {
      const md = toMarkdown();
      const blob = new Blob([md], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (CFG.product.name || "verilens") + "-docs.md";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
  function flash(btn, txt) {
    const old = btn.textContent; btn.textContent = txt;
    setTimeout(() => { btn.textContent = old; }, 1400);
  }
  function toMarkdown() {
    let md = `# ${CFG.product.name} — Documentation\n\n> ${CFG.product.oneLiner}\n\n`;
    SECTIONS.forEach((s) => {
      const node = el(s.id);
      md += `## ${s.label}\n\n`;
      // Pull readable text content from the section (skip the heading).
      if (node) {
        const clone = node.cloneNode(true);
        const h = clone.querySelector("h2"); if (h) h.remove();
        md += clone.textContent.replace(/\n{3,}/g, "\n\n").trim() + "\n\n";
      }
    });
    md += `---\n_Generated from /docs · ${new Date().toLocaleString()}_\n`;
    return md;
  }

  // ── LIVE DATA: manifest + API health ────────────────────────────────────────
  function renderLiveStatus() {
    const grid = el("statusGrid");
    grid.innerHTML = `
      <div class="docs-status-card" id="cardVersion"><div class="label">Extension</div><div class="value"><span class="dot wait"></span>…</div><div class="sub">manifest.json</div></div>
      <div class="docs-status-card" id="cardPlatforms"><div class="label">Platforms</div><div class="value">…</div><div class="sub">content scripts</div></div>
      <div class="docs-status-card" id="cardPerms"><div class="label">Permissions</div><div class="value">…</div><div class="sub">host + api</div></div>
      <div class="docs-status-card" id="cardApis"><div class="label">Live APIs</div><div id="apiRows"></div></div>`;

    // manifest.json (genuinely live)
    fetch(CFG.liveSources.manifestUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((m) => {
        const matches = (m.content_scripts && m.content_scripts[0] && m.content_scripts[0].matches) || [];
        const platforms = new Set(matches.map((u) => {
          if (u.includes("x.com") || u.includes("twitter")) return "X";
          if (u.includes("instagram")) return "Instagram";
          if (u.includes("facebook")) return "Facebook";
          return null;
        }).filter(Boolean));
        el("cardVersion").querySelector(".value").innerHTML = `<span class="dot up"></span>v${esc(m.version)}`;
        el("cardVersion").querySelector(".sub").textContent = "MV" + m.manifest_version + " · live";
        el("cardPlatforms").querySelector(".value").textContent = platforms.size || "—";
        el("cardPlatforms").querySelector(".sub").textContent = [...platforms].join(" · ") || "content scripts";
        const hp = (m.host_permissions || []).length;
        el("cardPerms").querySelector(".value").textContent = (m.permissions || []).length + " + " + hp;
        el("cardPerms").querySelector(".sub").textContent = "api perms + host perms";
      })
      .catch(() => {
        el("cardVersion").querySelector(".value").innerHTML = `<span class="dot down"></span>v${esc(CFG.product.versionFallback)}`;
        el("cardVersion").querySelector(".sub").textContent = "manifest unreachable";
        el("cardPlatforms").querySelector(".value").textContent = "3";
        el("cardPerms").querySelector(".value").textContent = "—";
      });

    // API health pings (genuinely live; CORS/opaque tolerated)
    const rows = el("apiRows");
    (CFG.liveSources.apis || []).forEach((api, i) => {
      const id = "api_" + i;
      rows.insertAdjacentHTML("beforeend",
        `<div class="api-status-row"><span><span class="dot wait" id="${id}"></span>${esc(api.name)}</span><span class="mono" id="${id}_t" style="font-size:11px;color:var(--text-dim)">…</span></div>`);
      const t0 = performance.now();
      // no-cors so a reachable host resolves even without CORS headers; a network
      // failure (down/DNS) rejects → we mark it down.
      fetch(api.url, { method: "GET", mode: "no-cors", cache: "no-store" })
        .then(() => {
          el(id).className = "dot up";
          el(id + "_t").textContent = Math.round(performance.now() - t0) + "ms";
        })
        .catch(() => {
          el(id).className = "dot down";
          el(id + "_t").textContent = "down";
        });
    });
  }

  // ── MERMAID (lazy CDN load) ─────────────────────────────────────────────────
  let mermaidReady = null;
  function loadMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
      s.onload = () => resolve(window.mermaid);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return mermaidReady;
  }
  function mermaidTheme() { return root.getAttribute("data-theme") === "dark" ? "dark" : "default"; }

  function initDiagrams() {
    const nodes = Array.from(document.querySelectorAll(".mermaid"));
    if (!nodes.length) return;
    // keep raw source so we can re-render on theme switch
    nodes.forEach((n) => { n.dataset.src = n.textContent; });
    loadMermaid().then((mermaid) => {
      mermaid.initialize({ startOnLoad: false, theme: mermaidTheme(), securityLevel: "strict" });
      renderAllDiagrams(mermaid);
    }).catch(() => {
      document.querySelectorAll("[data-fallback]").forEach((f) => { f.hidden = false; });
    });
  }
  async function renderAllDiagrams(mermaid) {
    const nodes = Array.from(document.querySelectorAll(".mermaid"));
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      try {
        const { svg } = await mermaid.render("mmd_" + i + "_" + Date.now(), n.dataset.src);
        n.innerHTML = svg;
      } catch (e) {
        const fb = document.querySelector(`[data-fallback="${n.dataset.diagram}"]`);
        if (fb) fb.hidden = false;
      }
    }
  }
  function reRenderDiagrams() {
    if (!window.mermaid) return;
    window.mermaid.initialize({ startOnLoad: false, theme: mermaidTheme(), securityLevel: "strict" });
    renderAllDiagrams(window.mermaid);
  }

  // ── BOOT ────────────────────────────────────────────────────────────────────
  const state = PREVIEW ? { ok: true } : accessState();
  if (!state.ok) { showGate(state); applyTheme(localStorage.getItem(THEME_KEY) || "dark"); }
  else mount();
})();
