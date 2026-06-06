// lib/provenanceLocalMock.js
// Deterministic mock for the LOCAL C2PA / Content Credentials pre-check.
// ~20% of posts return a signed "present" credential; the rest "absent".
// Determinism is keyed on contentHash so a given post always resolves the same.
//
// Shape returned (matches the Stage A contract):
//   { found, standard: "c2pa"|null, source, state: "present"|"absent" }
(function (g) {
  // Plausible C2PA issuers / generators a real manifest might name.
  const SOURCES = [
    "Adobe Firefly",
    "OpenAI DALL·E 3",
    "Google Imagen",
    "Adobe Photoshop (Generative Fill)",
    "Microsoft Designer",
  ];

  // Independent 0..1 seed from the contentHash (its own transform so it doesn't
  // track the deepfake band).
  function seed01(contentHash) {
    const hex = String(contentHash || "").replace(/[^0-9a-f]/gi, "");
    const n = parseInt(hex.slice(-8), 16) || 0;
    const m = Math.imul(n ^ 0x85ebca6b, 0xc2b2ae35) >>> 0; // decorrelate
    return (m % 1000) / 1000;
  }

  function check(payload) {
    const r = seed01(payload.contentHash);

    // ~20% carry a signed, AI-declaring credential.
    if (r < 0.2) {
      const source = SOURCES[Math.floor(r * 1000) % SOURCES.length];
      return { found: true, standard: "c2pa", source, state: "present" };
    }
    return { found: false, standard: null, source: null, state: "absent" };
  }

  g.VerilensProvenanceMock = { check };
})(globalThis);
