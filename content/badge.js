// content/badge.js
// Renders results into the per-post Shadow DOM panel.
//
// Deepfake and Fact-check are ALWAYS separate sections — never a single merged
// score. Each lives in its own slot keyed by data-kind, so running one doesn't
// wipe the other; you can have both showing at once.
(function (g) {
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- panel + section plumbing --------------------------------------------
  function ensurePanel(mount) {
    let panel = mount.querySelector(".verilens-panel");
    if (!panel) {
      panel = el("div", "verilens-panel");
      mount.append(panel);
    }
    return panel;
  }

  // Get (or create) the section for a kind. Deepfake always sorts above
  // fact-check regardless of which ran first.
  function ensureSection(mount, kind) {
    const panel = ensurePanel(mount);
    let section = panel.querySelector('[data-kind="' + kind + '"]');
    if (!section) {
      section = el("div", "verilens-section");
      section.dataset.kind = kind;
      if (kind === "deepfake") {
        panel.prepend(section);
      } else {
        panel.append(section);
      }
    }
    section.innerHTML = "";
    return section;
  }

  function sectionHead(section, title, cached) {
    const head = el("div", "verilens-section-head");
    head.append(el("span", "verilens-section-title", title));
    if (cached) head.append(el("span", "verilens-chip", "cached"));
    section.append(head);
  }

  // ---- Deepfake ------------------------------------------------------------
  const BAND_LABEL = {
    green: "Likely real",
    amber: "Uncertain",
    red: "Likely AI-generated",
  };

  function renderDeepfake(mount, result) {
    const section = ensureSection(mount, "deepfake");

    if (result && result.error) {
      sectionHead(section, "Deepfake check", false);
      section.append(el("div", "verilens-error", "Couldn't check this post. Try again."));
      return;
    }

    sectionHead(section, "Deepfake check", result.cached);

    const img = result.media && result.media.image;
    const band = result.band || "amber";

    const verdictRow = el("div", "verilens-verdict-row " + band);
    verdictRow.append(el("span", "verilens-dot"));
    verdictRow.append(el("span", "verilens-verdict-label", BAND_LABEL[band] || "Uncertain"));
    if (img && typeof img.aiGenerated === "number") {
      verdictRow.append(el("span", "verilens-prob", Math.round(img.aiGenerated * 100) + "% AI"));
    }
    section.append(verdictRow);

    const media = result.media || {};
    const hints = [];
    if (media.video && media.video.available === false && media.video.reason === "premium_required") {
      hints.push("Video analysis is a premium feature.");
    }
    if (media.audio && media.audio.available === false && media.audio.reason === "premium_required") {
      hints.push("Audio analysis is a premium feature.");
    }
    if (hints.length) {
      section.append(el("div", "verilens-hint", "🔒 " + hints.join(" ")));
    }

    if (result.explanation) {
      section.append(el("p", "verilens-explain", result.explanation));
    }
  }

  // ---- Fact-check ----------------------------------------------------------
  // Map fact-check vocab onto the same colour bands used elsewhere.
  const OVERALL_BAND = {
    mostly_true: "green",
    mixed: "amber",
    mostly_false: "red",
    unverifiable: "grey",
  };
  const OVERALL_LABEL = {
    mostly_true: "Mostly true",
    mixed: "Mixed",
    mostly_false: "Mostly false",
    unverifiable: "Unverifiable",
  };
  const CLAIM_BAND = {
    corroborated: "green",
    contradicted: "red",
    unverifiable: "grey",
    developing: "amber",
  };
  const CLAIM_LABEL = {
    corroborated: "Corroborated",
    contradicted: "Contradicted",
    unverifiable: "Unverifiable",
    developing: "Developing",
  };

  function claimNode(claim) {
    const node = el("div", "verilens-claim");
    const band = CLAIM_BAND[claim.verdict] || "grey";

    const top = el("div", "verilens-claim-top");
    top.append(el("span", "verilens-pill " + band, CLAIM_LABEL[claim.verdict] || claim.verdict));
    if (typeof claim.confidence === "number") {
      top.append(el("span", "verilens-prob", Math.round(claim.confidence * 100) + "% conf"));
    }
    node.append(top);

    node.append(el("p", "verilens-claim-text", claim.claim));

    if (Array.isArray(claim.sources) && claim.sources.length) {
      const list = el("div", "verilens-sources");
      claim.sources.forEach((s) => {
        const row = el("div", "verilens-source");
        const a = el("a", "verilens-source-link", s.outlet);
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        row.append(a);
        if (s.summary) row.append(el("span", "verilens-source-summary", " — " + s.summary));
        list.append(row);
      });
      node.append(list);
    }
    return node;
  }

  function renderFactcheck(mount, result) {
    const section = ensureSection(mount, "factcheck");

    if (result && result.error) {
      sectionHead(section, "Fact-check", false);
      section.append(el("div", "verilens-error", "Couldn't fact-check this post. Try again."));
      return;
    }

    sectionHead(section, "Fact-check", result.cached);

    const band = OVERALL_BAND[result.overall] || "grey";
    const overallRow = el("div", "verilens-verdict-row " + band);
    overallRow.append(el("span", "verilens-dot"));
    overallRow.append(el("span", "verilens-verdict-label", OVERALL_LABEL[result.overall] || "Unverifiable"));
    section.append(overallRow);

    if (result.explanation) {
      section.append(el("p", "verilens-explain", result.explanation));
    }

    (result.claims || []).forEach((c) => section.append(claimNode(c)));
  }

  // ---- Upgrade prompt (premium gate) ---------------------------------------
  // handlers: { onUpgrade, onDevEnable } — wired by actions.js.
  function renderUpgrade(mount, info, handlers) {
    const section = ensureSection(mount, "factcheck");
    sectionHead(section, "Fact-check", false);

    const card = el("div", "verilens-upgrade");
    card.append(el("div", "verilens-upgrade-title", "🔒 Premium feature"));
    card.append(el("p", "verilens-explain", info.message || "Upgrade to Premium to use this."));

    const cta = el("button", "verilens-cta", "Upgrade to Premium");
    cta.addEventListener("click", () => handlers && handlers.onUpgrade && handlers.onUpgrade());
    card.append(cta);

    // Dev-only shortcut so you can test the premium path before the popup's
    // tier switch exists (M4). Clearly labelled.
    const dev = el("button", "verilens-dev-link", "Enable premium (dev)");
    dev.addEventListener("click", () => handlers && handlers.onDevEnable && handlers.onDevEnable());
    card.append(dev);

    section.append(card);
  }

  g.VerilensBadge = { renderDeepfake, renderFactcheck, renderUpgrade };
})(globalThis);
