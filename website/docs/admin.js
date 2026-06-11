// website/docs/admin.js
// Admin panel for the /docs module. Edits a working `model` (effective config),
// saves a draft or publishes to the localStorage overlay the public page reads,
// keeps version snapshots, and exports JSON / content.js / Markdown.
//
// Storage keys (browser-local; see admin warning banner for the permanence caveat):
//   verilens_docs_overrides  → what /docs renders (published)
//   verilens_docs_draft      → unpublished draft
//   verilens_docs_versions   → [{ ts, label, data }]  publish history
(function () {
  "use strict";

  const DEFAULTS = window.VerilensDocs;
  const K_OVER = "verilens_docs_overrides";
  const K_DRAFT = "verilens_docs_draft";
  const K_VERS = "verilens_docs_versions";
  const SESSION = "verilens_docs_admin_ok";

  applyTheme(localStorage.getItem("verilens_site_theme") || "dark");
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }

  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function deepMerge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k in over) {
      if (isObj(out[k]) && isObj(over[k])) out[k] = deepMerge(out[k], over[k]);
      else out[k] = over[k];
    }
    return out;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function el(id) { return document.getElementById(id); }
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }

  // ── working model ───────────────────────────────────────────────────────────
  function loadModel() {
    const base = clone(DEFAULTS);
    const over = read(K_OVER);
    const draft = read(K_DRAFT);
    return deepMerge(deepMerge(base, over || {}), draft || {});
  }
  let model = loadModel();
  let dirty = false;

  function markDirty() {
    dirty = true;
    const s = el("dirtyStatus");
    s.textContent = "Unsaved changes"; s.className = "admin-status dirty";
  }
  function markSaved(msg) {
    dirty = false;
    const s = el("dirtyStatus");
    s.textContent = msg || "Saved"; s.className = "admin-status saved";
  }

  // ── GATE ────────────────────────────────────────────────────────────────────
  function currentPass() {
    const m = loadModel();
    return (m.access && m.access.adminPassphrase) || (DEFAULTS.access && DEFAULTS.access.adminPassphrase) || "";
  }
  function unlock() { el("adminGate").hidden = true; el("adminApp").hidden = false; populate(); }
  if (sessionStorage.getItem(SESSION) === "1") unlock();
  function tryPass() {
    if (el("passInput").value === currentPass()) {
      sessionStorage.setItem(SESSION, "1"); el("passErr").hidden = true; unlock();
    } else { el("passErr").hidden = false; }
  }
  el("passBtn").addEventListener("click", tryPass);
  el("passInput").addEventListener("keydown", (e) => { if (e.key === "Enter") tryPass(); });

  // ── POPULATE FORM ───────────────────────────────────────────────────────────
  function populate() {
    const a = model.access || {};
    el("acEnabled").checked = !!a.enabled;
    el("acSchedule").checked = !!a.useSchedule;
    el("acStart").value = a.start || "";
    el("acEnd").value = a.end || "";
    el("acPass").value = a.adminPassphrase || "";

    const p = model.product || {};
    el("pName").value = p.name || "";
    el("pTagline").value = p.tagline || "";
    el("pOneLiner").value = p.oneLiner || "";
    el("pRepo").value = p.repo || "";

    el("teamName").value = (model.team && model.team.name) || "";
    el("diagArch").value = (model.diagrams && model.diagrams.architecture) || "";
    el("diagFlow").value = (model.diagrams && model.diagrams.dataflow) || "";

    el("advJson").value = JSON.stringify(advancedSubset(model), null, 2);

    renderPitch(); renderTeam(); renderFeatures(); renderVersions();

    // scalar field listeners
    [["acEnabled","change"],["acSchedule","change"],["acStart","input"],["acEnd","input"],["acPass","input"],
     ["pName","input"],["pTagline","input"],["pOneLiner","input"],["pRepo","input"],
     ["teamName","input"],["diagArch","input"],["diagFlow","input"],["advJson","input"]]
      .forEach(([id, ev]) => el(id).addEventListener(ev, markDirty));
  }

  function advancedSubset(m) {
    const keys = ["overview","stack","apis","dataLayer","aiLayer","roadmap","performance","security","analytics","changelog"];
    const out = {};
    keys.forEach((k) => { if (m[k] !== undefined) out[k] = m[k]; });
    return out;
  }

  // ── PITCH LIST (reorderable) ────────────────────────────────────────────────
  function renderPitch() {
    const wrap = el("pitchList"); wrap.innerHTML = "";
    (model.pitch || []).forEach((sec, i) => {
      const item = document.createElement("div");
      item.className = "admin-item"; item.draggable = true; item.dataset.i = i;
      item.innerHTML = `
        <div class="admin-item-head">
          <span class="grab" title="Drag to reorder">⠿</span>
          <strong>${esc(sec.title || "Untitled")}</strong>
          <button class="admin-mini" data-up>↑</button>
          <button class="admin-mini" data-down>↓</button>
          <button class="admin-mini danger" data-del>Remove</button>
        </div>
        <div class="admin-field"><label>Title</label><input type="text" data-f="title" value="${esc(sec.title)}" /></div>
        <div class="admin-field"><label>Body</label><textarea data-f="body">${esc(sec.body)}</textarea></div>`;
      item.querySelector('[data-f="title"]').addEventListener("input", (e) => { sec.title = e.target.value; item.querySelector("strong").textContent = e.target.value || "Untitled"; markDirty(); });
      item.querySelector('[data-f="body"]').addEventListener("input", (e) => { sec.body = e.target.value; markDirty(); });
      item.querySelector("[data-del]").addEventListener("click", () => { model.pitch.splice(i, 1); markDirty(); renderPitch(); });
      item.querySelector("[data-up]").addEventListener("click", () => move(model.pitch, i, -1, renderPitch));
      item.querySelector("[data-down]").addEventListener("click", () => move(model.pitch, i, 1, renderPitch));
      addDragReorder(item, wrap, model.pitch, renderPitch);
      wrap.appendChild(item);
    });
  }
  el("addPitch").addEventListener("click", () => {
    model.pitch = model.pitch || [];
    model.pitch.push({ id: "section-" + Date.now(), title: "New Section", body: "" });
    markDirty(); renderPitch();
  });

  function move(arr, i, dir, rerender) {
    const j = i + dir; if (j < 0 || j >= arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t; markDirty(); rerender();
  }

  let dragSrc = null;
  function addDragReorder(item, wrap, arr, rerender) {
    item.addEventListener("dragstart", () => { dragSrc = item; item.classList.add("dragging"); });
    item.addEventListener("dragend", () => { item.classList.remove("dragging"); dragSrc = null; });
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === item) return;
      const from = +dragSrc.dataset.i, to = +item.dataset.i;
      const [moved] = arr.splice(from, 1); arr.splice(to, 0, moved);
      markDirty(); rerender();
    });
  }

  // ── TEAM ────────────────────────────────────────────────────────────────────
  function renderTeam() {
    const wrap = el("memberList"); wrap.innerHTML = "";
    const members = (model.team && model.team.members) || [];
    members.forEach((m, i) => {
      const initials = (m.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      const hue = Math.abs(hashStr(m.name || "")) % 360;
      const item = document.createElement("div");
      item.className = "admin-item";
      const prev = m.photo
        ? `<img class="prev" src="${esc(m.photo)}" alt="" />`
        : `<div class="prev" style="background:hsl(${hue} 60% 45%)">${esc(initials)}</div>`;
      item.innerHTML = `
        <div class="admin-team-row">
          <div class="admin-team-photo">
            ${prev}
            <label class="admin-mini" style="display:inline-block">Upload<input type="file" accept="image/*" hidden /></label>
            ${m.photo ? '<button class="admin-mini danger" data-clearimg style="margin-top:6px">Clear</button>' : ""}
          </div>
          <div class="admin-team-fields">
            <div class="admin-row">
              <div class="admin-field" style="margin:0"><label>Full name</label><input type="text" data-f="name" value="${esc(m.name)}" /></div>
              <div class="admin-field" style="margin:0"><label>Role</label><input type="text" data-f="role" value="${esc(m.role)}" /></div>
            </div>
            <div class="admin-field" style="margin:0"><label>Email</label><input type="email" data-f="email" value="${esc(m.email)}" /></div>
            <div><button class="admin-mini danger" data-del>Remove member</button></div>
          </div>
        </div>`;
      item.querySelector('[data-f="name"]').addEventListener("input", (e) => { m.name = e.target.value; markDirty(); });
      item.querySelector('[data-f="role"]').addEventListener("input", (e) => { m.role = e.target.value; markDirty(); });
      item.querySelector('[data-f="email"]').addEventListener("input", (e) => { m.email = e.target.value; markDirty(); });
      item.querySelector('input[type="file"]').addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        resizeImage(f).then((dataUrl) => { m.photo = dataUrl; markDirty(); renderTeam(); });
      });
      const clr = item.querySelector("[data-clearimg]");
      if (clr) clr.addEventListener("click", () => { m.photo = ""; markDirty(); renderTeam(); });
      item.querySelector("[data-del]").addEventListener("click", () => { members.splice(i, 1); markDirty(); renderTeam(); });
      wrap.appendChild(item);
    });
  }
  el("addMember").addEventListener("click", () => {
    model.team = model.team || { members: [] };
    model.team.members = model.team.members || [];
    model.team.members.push({ name: "New Member", role: "", email: "", photo: "" });
    markDirty(); renderTeam();
  });

  // Auto-resize uploaded image to a uniform 320×320 (cover-crop) JPEG data URL.
  function resizeImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const S = 320;
          const c = document.createElement("canvas"); c.width = S; c.height = S;
          const ctx = c.getContext("2d");
          const scale = Math.max(S / img.width, S / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          resolve(c.toDataURL("image/jpeg", 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── FEATURES ────────────────────────────────────────────────────────────────
  function renderFeatures() {
    const wrap = el("featureList"); wrap.innerHTML = "";
    (model.features || []).forEach((f, i) => {
      const item = document.createElement("div");
      item.className = "admin-item";
      item.innerHTML = `
        <div class="admin-row">
          <div class="admin-field" style="margin:0;flex:2"><label>Capability</label><input type="text" data-f="name" value="${esc(f.name)}" /></div>
          <div class="admin-field" style="margin:0"><label>Tier</label>
            <select data-f="tier">${opt(["Free","Pro","—"], f.tier)}</select></div>
          <div class="admin-field" style="margin:0"><label>Status</label>
            <select data-f="status">${opt(["live","upcoming","planned"], f.status)}</select></div>
        </div>
        <div class="admin-row" style="margin-top:10px">
          <div class="admin-field" style="margin:0;flex:3"><label>Notes</label><input type="text" data-f="note" value="${esc(f.note)}" /></div>
          <div style="display:flex;align-items:flex-end"><button class="admin-mini danger" data-del>Remove</button></div>
        </div>`;
      ["name","tier","status","note"].forEach((k) => {
        item.querySelector(`[data-f="${k}"]`).addEventListener("input", (e) => { f[k] = e.target.value; markDirty(); });
        item.querySelector(`[data-f="${k}"]`).addEventListener("change", (e) => { f[k] = e.target.value; markDirty(); });
      });
      item.querySelector("[data-del]").addEventListener("click", () => { model.features.splice(i, 1); markDirty(); renderFeatures(); });
      wrap.appendChild(item);
    });
  }
  function opt(vals, sel) { return vals.map((v) => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join(""); }
  el("addFeature").addEventListener("click", () => {
    model.features = model.features || [];
    model.features.push({ name: "New capability", tier: "Pro", status: "planned", note: "" });
    markDirty(); renderFeatures();
  });

  // ── COLLECT (DOM → model) ───────────────────────────────────────────────────
  function collect() {
    model.access = model.access || {};
    model.access.enabled = el("acEnabled").checked;
    model.access.useSchedule = el("acSchedule").checked;
    model.access.start = el("acStart").value;
    model.access.end = el("acEnd").value;
    model.access.adminPassphrase = el("acPass").value;

    model.product = model.product || {};
    model.product.name = el("pName").value;
    model.product.tagline = el("pTagline").value;
    model.product.oneLiner = el("pOneLiner").value;
    model.product.repo = el("pRepo").value;

    model.team = model.team || {};
    model.team.name = el("teamName").value;

    model.diagrams = model.diagrams || {};
    model.diagrams.architecture = el("diagArch").value;
    model.diagrams.dataflow = el("diagFlow").value;

    // advanced JSON
    const parsed = JSON.parse(el("advJson").value); // throws → caught by caller
    Object.assign(model, parsed);
    return model;
  }

  function validateAdvanced() {
    el("jsonErr").hidden = true;
    try { JSON.parse(el("advJson").value); return true; }
    catch (e) { el("jsonErr").hidden = false; el("jsonErr").textContent = "Technical Content JSON is invalid: " + e.message; return false; }
  }

  // ── SAVE / PUBLISH ──────────────────────────────────────────────────────────
  el("btnSaveDraft").addEventListener("click", () => {
    if (!validateAdvanced()) return;
    try { collect(); } catch (e) { return; }
    localStorage.setItem(K_DRAFT, JSON.stringify(model));
    markSaved("Draft saved");
  });

  el("btnPublish").addEventListener("click", () => {
    if (!validateAdvanced()) return;
    try { collect(); } catch (e) { return; }
    localStorage.setItem(K_OVER, JSON.stringify(model));
    localStorage.removeItem(K_DRAFT);
    // version snapshot
    const versions = read(K_VERS) || [];
    versions.unshift({ ts: Date.now(), label: "Published", data: clone(model) });
    localStorage.setItem(K_VERS, JSON.stringify(versions.slice(0, 20)));
    markSaved("Published ✓");
    renderVersions();
  });

  el("btnPreview").addEventListener("click", () => {
    // Save a draft preview overlay so /docs reflects unpublished edits too.
    if (validateAdvanced()) { try { collect(); localStorage.setItem(K_DRAFT, JSON.stringify(model)); } catch (e) {} }
    window.open("index.html?preview=1", "_blank");
  });

  el("revertDefaults").addEventListener("click", () => {
    if (!confirm("Remove all local edits and restore the committed defaults? Published overrides and draft will be cleared.")) return;
    localStorage.removeItem(K_OVER);
    localStorage.removeItem(K_DRAFT);
    model = loadModel();
    populate();
    markSaved("Reverted to defaults");
  });

  // ── VERSIONS ────────────────────────────────────────────────────────────────
  function renderVersions() {
    const wrap = el("versionList");
    const versions = read(K_VERS) || [];
    if (!versions.length) { wrap.innerHTML = '<p class="hint" style="color:var(--text-dim);font-size:13px">No published versions yet.</p>'; return; }
    wrap.innerHTML = "";
    versions.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "admin-ver-row";
      row.innerHTML = `<span class="vt">${new Date(v.ts).toLocaleString()}</span>
        <button class="admin-mini" data-restore>Restore</button>`;
      row.querySelector("[data-restore]").addEventListener("click", () => {
        if (!confirm("Restore this version into the editor? (Publish to make it live.)")) return;
        model = deepMerge(clone(DEFAULTS), v.data);
        populate(); markDirty();
      });
      wrap.appendChild(row);
    });
  }

  // ── EXPORTS ─────────────────────────────────────────────────────────────────
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    URL.revokeObjectURL(a.href);
  }
  el("exJson").addEventListener("click", () => {
    if (!validateAdvanced()) return; try { collect(); } catch (e) { return; }
    download("verilens-docs-config.json", JSON.stringify(model, null, 2), "application/json");
  });
  el("exContent").addEventListener("click", () => {
    if (!validateAdvanced()) return; try { collect(); } catch (e) { return; }
    const banner = "// website/docs/content.js — regenerated by the /docs admin panel.\n// Commit this file to make these edits permanent for everyone.\n";
    download("content.js", banner + "window.VerilensDocs = " + JSON.stringify(model, null, 2) + ";\n", "text/javascript");
  });
  el("exMd").addEventListener("click", () => {
    if (!validateAdvanced()) return; try { collect(); } catch (e) { return; }
    download((model.product.name || "verilens") + "-docs.md", toMarkdown(model), "text/markdown");
  });

  function toMarkdown(m) {
    let md = `# ${m.product.name} — Documentation\n\n> ${m.product.oneLiner}\n\n`;
    md += `## Pitch Deck\n\n`;
    (m.pitch || []).forEach((p) => { md += `### ${p.title}\n\n${p.body}\n\n`; });
    md += `## Team — ${m.team.name || ""}\n\n`;
    (m.team.members || []).forEach((x) => { md += `- **${x.name}** — ${x.role}${x.email ? " · " + x.email : ""}\n`; });
    md += `\n## Feature Matrix\n\n| Capability | Tier | Status | Notes |\n|---|---|---|---|\n`;
    (m.features || []).forEach((f) => { md += `| ${f.name} | ${f.tier} | ${f.status} | ${f.note} |\n`; });
    md += `\n## Technology Stack\n\n`;
    Object.keys(m.stack || {}).forEach((c) => { md += `**${c}:** ${m.stack[c].join(", ")}\n\n`; });
    md += `\n_Exported ${new Date().toLocaleString()}_\n`;
    return md;
  }

  // ── utils ───────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0; return h; }

  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
})();
