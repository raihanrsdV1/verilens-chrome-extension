// website/config.js
// The ONE place to edit pricing + product naming for the marketing site.
// No secrets here — safe to commit. Loaded before app.js in index.html/success.html.
window.VerilensSite = {
  productName: "Verilens",
  tagline: "Catch deepfakes & misinformation before you believe them.",

  // Prices are display-only (no real billing). Edit freely.
  prices: {
    monthly: { amount: 6.99, suffix: "/mo" },
    annual: { amount: 59, suffix: "/yr", perMonth: 4.92, savingsLabel: "Save $24/yr" },
  },

  // Where the extension's "Upgrade" button points. Keep in sync with WEBSITE_URL in
  // popup/popup.js. Default assumes `python -m http.server 8000` from the repo root.
  siteUrl: "http://localhost:8000/website/index.html",

  // Future deploy: uncomment + set, then add the host to manifest.json content_scripts.
  // pagesUrl: "https://YOURNAME.github.io/verilens-chrome-extension/website/index.html",
};
