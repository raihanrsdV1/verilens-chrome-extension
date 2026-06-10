(function (g) {
  var base = g.VERILENS_API_URL || "https://verilens-claim-extractor.vercel.app";
  var verifyBase = g.VERILENS_VERIFY_URL || "https://fact-verifier.vercel.app";
  g.VerilensConfig = {
    FACTCHECK_API: base + "/api/factcheck",
    VERIFY_API: verifyBase + "/api/verify",
  };
})(globalThis);
