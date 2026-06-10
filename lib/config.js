(function (g) {
  var existing = g.VerilensConfig || {};
  var base = g.VERILENS_API_URL || "https://verilens-claim-extractor.vercel.app";
  var verifyBase = g.VERILENS_VERIFY_URL || "https://fact-verifier.vercel.app";
  g.VerilensConfig = existing;
  existing.FACTCHECK_API = base + "/api/factcheck";
  existing.VERIFY_API = verifyBase + "/api/verify";
})(globalThis);
