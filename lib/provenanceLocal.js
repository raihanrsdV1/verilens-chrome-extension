// lib/provenanceLocal.js
// STAGE A — LOCAL provenance pre-check. Runs entirely inside the extension.
// NO ML model, NO remote code, NO API key. Pure METADATA parsing of C2PA /
// Content Credentials embedded in the image bytes.
//
// Why local is possible: C2PA is an OPEN, signed-manifest standard embedded in
// the file — parsing it needs only code, not a model (unlike SynthID, which is
// hosted/keyed and therefore lives BACKEND-side).
//
// Returns: { found, standard: "c2pa"|null, source, state: "present"|"absent" }
//
// ── REAL vs MOCK ────────────────────────────────────────────────────────────
// MODE = "real": fetch the image bytes (worker has host permission) and scan
//   for a C2PA/JUMBF manifest that DECLARES AI generation. This actually reads
//   the file — not a stub.
// MODE = "mock": deterministic stub (~20% present) for demoing the UI, since
//   most platforms (X/Twitter) STRIP C2PA on upload so the real parser will
//   read "absent" on nearly every real post.
//
// LIMITATION (real mode): this DETECTS + reads the manifest; it does NOT verify
// the cryptographic COSE signature. For trust-grade verification, run the
// official `c2pa` WASM SDK (validates the signature + trust list) — see TODO.
// ─────────────────────────────────────────────────────────────────────────────
(function (g) {
  const MODE = "real"; // "real" | "mock"

  // Cap how many bytes we read/scan. C2PA in JPEG lives in APP11 segments near
  // the START of the file, so the head is almost always enough — and it keeps
  // the fetch cheap (important on the filter path, which runs per visible post).
  const MAX_BYTES = 700000; // ~700 KB

  // IPTC digitalSourceType values (and near-synonyms) that indicate AI.
  const AI_MARKERS = [
    "trainedAlgorithmicMedia", // fully AI-generated
    "compositeWithTrainedAlgorithmicMedia", // AI-composited
    "algorithmicMedia",
  ];

  // Best-effort generator names to surface as the "source".
  const KNOWN_SOURCES = [
    "Adobe Firefly",
    "DALL",
    "Midjourney",
    "Imagen",
    "Stable Diffusion",
    "Photoshop",
    "Designer",
    "Gemini",
    "Leonardo",
    "Firefly",
  ];

  // Find an ASCII substring inside a byte array (no full decode of binary data).
  function indexOfAscii(bytes, str) {
    const needle = new TextEncoder().encode(str);
    const n = needle.length;
    if (!n || bytes.length < n) return -1;
    outer: for (let i = 0; i + n <= bytes.length; i++) {
      for (let j = 0; j < n; j++) {
        if (bytes[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }
  const has = (bytes, str) => indexOfAscii(bytes, str) !== -1;

  async function parseImage(url) {
    // Range-limit the download to the head where C2PA usually lives. Servers
    // that ignore Range just return the whole file; we still only scan MAX_BYTES.
    const resp = await fetch(url, { headers: { Range: "bytes=0-" + (MAX_BYTES - 1) } });
    const full = new Uint8Array(await resp.arrayBuffer());
    const bytes = full.length > MAX_BYTES ? full.subarray(0, MAX_BYTES) : full;

    // 1) Is there a C2PA / JUMBF manifest at all?
    const hasManifest =
      has(bytes, "c2pa.assertions") ||
      has(bytes, "c2pa.claim") ||
      has(bytes, "c2pa.manifest") ||
      (has(bytes, "jumb") && has(bytes, "c2pa"));
    if (!hasManifest) {
      return { found: false, standard: null, source: null, state: "absent" };
    }

    // 2) Does the manifest DECLARE AI generation? C2PA can also sign a real
    //    camera/Photoshop image — we must NOT flag those as AI.
    const declaresAI = AI_MARKERS.some((m) => has(bytes, m));
    if (!declaresAI) {
      // Credentialed but not AI → not a "confirmed AI" hit for our purposes.
      // (Could be surfaced as "verified authentic" in a future iteration.)
      return { found: true, standard: "c2pa", source: null, state: "absent" };
    }

    const source = KNOWN_SOURCES.find((k) => has(bytes, k)) || "C2PA Content Credentials";
    return { found: true, standard: "c2pa", source, state: "present" };

    // TODO(verify): the above detects + reads the manifest but does NOT verify
    // the COSE signature. Plug the official in-browser `c2pa` WASM SDK for
    // trust-grade validation:
    //   const c2pa = await createC2pa({ wasmSrc, workerSrc });   // bundled assets
    //   const { manifestStore } = await c2pa.read(blob);
    //   inspect manifestStore.activeManifest assertions + validationStatus.
  }

  async function check(payload) {
    const imageUrls = payload.imageUrls || [];
    if (!imageUrls.length) {
      return { found: false, standard: null, source: null, state: "absent" };
    }

    if (MODE === "mock") return g.VerilensProvenanceMock.check(payload);

    try {
      // Check the post's primary image. (Multi-image posts: extend to scan all.)
      return await parseImage(imageUrls[0]);
    } catch (e) {
      // Network/parse failure → treat as absent. Provenance must never block or
      // throw; absence simply routes to the model.
      return { found: false, standard: null, source: null, state: "absent" };
    }
  }

  g.VerilensProvenance = { check };
})(globalThis);
