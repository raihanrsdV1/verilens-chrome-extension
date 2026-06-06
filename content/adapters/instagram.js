// content/adapters/instagram.js
// Platform adapter for Instagram. All IG-specific DOM knowledge lives here.
//
// IG's markup uses obfuscated class names, so we anchor ONLY on stable things:
// <article>, permalinks to /p/<shortcode>/ and /reel/<shortcode>/, <time>,
// <img alt> (content photos carry descriptive alt text), and <video>.
//
// NOTE: IG iterates its DOM often; if extraction breaks, this file is the one
// to retune. Selectors below are best-effort and commented.
(function (g) {
  // Feed posts are <article> elements.
  function findPosts() {
    return Array.from(document.querySelectorAll("article"));
  }

  // Permalink: a link to /p/<shortcode>/ or /reel/<shortcode>/. The <time>'s
  // anchor is the most reliable, with a plain href fallback.
  function extractPermalink(postEl) {
    let a = null;
    const timeEl = postEl.querySelector("time");
    if (timeEl) a = timeEl.closest("a");
    if (!a) a = postEl.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    if (!a) return { postUrl: "", postId: "" };

    const href = a.getAttribute("href") || "";
    const postUrl = href.startsWith("http") ? href : location.origin + href;
    const m = href.match(/\/(?:p|reel)\/([^/]+)/);
    return { postUrl, postId: m ? m[1] : "" };
  }

  // Caption: IG often renders the caption in an <h1> (single-post view) or in a
  // span within the caption block. Best-effort, with a couple of fallbacks.
  function extractCaption(postEl) {
    const h1 = postEl.querySelector("h1");
    if (h1 && h1.innerText.trim()) return h1.innerText.trim();

    // Caption commonly sits in a list item / span near the username link.
    const span = postEl.querySelector('ul span[dir="auto"], span[dir="auto"]');
    return span ? span.innerText.trim() : "";
  }

  // Content photos are served from *.cdninstagram.com OR *.fbcdn.net (IG uses
  // both). We skip avatars/profile pics and tiny chrome.
  function extractImageUrls(postEl) {
    const imgs = Array.from(postEl.querySelectorAll("img"));
    const urls = imgs
      .filter((img) => {
        const src = img.currentSrc || img.src || "";
        if (!/cdninstagram\.com|fbcdn\.net/.test(src)) return false;
        if (/profile picture/i.test(img.alt || "")) return false; // avatars
        // Content images carry alt text, a srcset, or are reasonably large.
        const big = (img.naturalWidth || img.width || 0) >= 150;
        return !!(img.alt || img.srcset || big);
      })
      .map((img) => img.currentSrc || img.src);
    return Array.from(new Set(urls));
  }

  function hasVideo(postEl) {
    return !!postEl.querySelector("video");
  }

  function extractPostData(postEl) {
    const { postUrl, postId } = extractPermalink(postEl);
    const captionText = extractCaption(postEl);
    const imageUrls = extractImageUrls(postEl);
    const video = hasVideo(postEl);

    return {
      postId,
      postUrl,
      contentHash: g.VerilensHash.contentHash(imageUrls, captionText),
      imageUrls,
      captionText,
      hasVideo: video,
      hasAudio: video,
    };
  }

  // Anchor near the action row (the like/comment/share bar is a <section> that
  // follows the media). Fall back to appending to the article.
  function getActionAnchor(postEl) {
    const section = postEl.querySelector("section");
    if (section && section.parentElement) {
      return { parent: section.parentElement, before: section };
    }
    return { parent: postEl, before: null };
  }

  g.VerilensAdapters = g.VerilensAdapters || {};
  g.VerilensAdapters.instagram = { findPosts, extractPostData, getActionAnchor };
})(globalThis);
