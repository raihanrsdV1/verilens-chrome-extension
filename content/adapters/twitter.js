// content/adapters/twitter.js
// Platform adapter for X / Twitter. ALL knowledge of X's DOM lives here so the
// rest of the extension is platform-agnostic. When X changes its markup, this
// is the only file that should need touching.
//
// Selector rules (from the spec): anchor only on STABLE things — [role],
// [data-testid], <img>, <time> permalinks. NEVER obfuscated CSS class names.
(function (g) {
  // Every tweet (timeline, thread, quote) is an <article role="article">.
  function findPosts() {
    return Array.from(document.querySelectorAll('article[role="article"]'));
  }

  // The permalink is the <time> element, which sits inside the <a> that points
  // at /<user>/status/<id>. That gives us BOTH a canonical URL and the native id.
  function extractPermalink(postEl) {
    const timeAnchor = postEl.querySelector('a[href*="/status/"] time');
    const a = timeAnchor ? timeAnchor.closest("a") : null;
    if (!a) return { postUrl: "", postId: "" };

    const href = a.getAttribute("href") || "";
    const postUrl = href.startsWith("http") ? href : location.origin + href;
    const m = href.match(/\/status\/(\d+)/);
    return { postUrl, postId: m ? m[1] : "" };
  }

  // A quote tweet nests the QUOTED (earlier) post inside the same <article> as
  // a `div[role="link"]` card — with its OWN tweetText and tweetPhoto. A plain
  // querySelector would only return the outer author's commentary and drop the
  // quoted post's caption, even though its IMAGE is what we're analyzing. So we
  // collect every tweetText in the article and label the quoted one, giving the
  // backend the full textual context (and a contentHash that reflects both).
  function extractCaption(postEl) {
    const nodes = Array.from(postEl.querySelectorAll('[data-testid="tweetText"]'));
    if (!nodes.length) return "";

    const parts = nodes.map((node) => {
      const text = node.innerText.trim();
      if (!text) return "";
      const isQuoted = !!node.closest('div[role="link"]');
      return isQuoted ? "[Quoted post] " + text : text;
    });

    return parts.filter(Boolean).join("\n\n");
  }

  // Real attached photos live under [data-testid="tweetPhoto"] and are served
  // from pbs.twimg.com/media. We deliberately skip avatars/emoji/card thumbs.
  function extractImageUrls(postEl) {
    const imgs = Array.from(
      postEl.querySelectorAll('[data-testid="tweetPhoto"] img')
    );
    const urls = imgs
      .map((img) => img.currentSrc || img.src)
      .filter((src) => src && /twimg\.com\/media/.test(src));
    return Array.from(new Set(urls)); // dedupe
  }

  function hasVideo(postEl) {
    return !!postEl.querySelector(
      '[data-testid="videoPlayer"], [data-testid="videoComponent"], video'
    );
  }

  // Best-effort <video> src. On X this is almost always a blob:/MSE URL the real
  // backend can't fetch — mock fallback. On IG/FB, often a fetchable HTTPS CDN URL.
  function extractVideoUrl(postEl) {
    const v = postEl.querySelector("video");
    if (!v) return "";
    const src = v.currentSrc || v.src;
    if (src) return src;
    const source = v.querySelector("source");
    return source && source.src ? source.src : "";
  }

  // Returns the shape the whole extension agrees on.
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
      videoUrl: video ? extractVideoUrl(postEl) : "",
      // On X, native videos carry audio; treat them together for now.
      hasAudio: video,
    };
  }

  // Where to hang our control. The action bar (reply/retweet/like) is a stable
  // [role="group"]; we insert just before it so our control sits under the post
  // content but above the action row. Fallback to the article itself.
  function getActionAnchor(postEl) {
    const group = postEl.querySelector('[role="group"]');
    if (group && group.parentElement) {
      return { parent: group.parentElement, before: group };
    }
    return { parent: postEl, before: null };
  }

  g.VerilensAdapters = g.VerilensAdapters || {};
  g.VerilensAdapters.twitter = {
    findPosts,
    extractPostData,
    getActionAnchor,
  };
})(globalThis);
