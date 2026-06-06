// content/adapters/facebook.js
// Platform adapter for Facebook. FB has the most hostile markup (fully
// obfuscated class names that rotate), so we anchor STRICTLY on stable,
// semantic hooks:
//   - [role="article"]            → a feed post
//   - [data-ad-preview="message"] / [data-ad-comet-preview="message"] → post text
//   - a[href*="/posts/"], a[href*="story_fbid="], a[href*="/photo"] → permalink
//   - img[src*="fbcdn.net"], video → media
//
// FB changes constantly; if extraction breaks, retune HERE only. Selectors are
// best-effort and commented.
(function (g) {
  function findPosts() {
    return Array.from(document.querySelectorAll('[role="article"]'));
  }

  // Permalink: the timestamp link, or any link to a post/photo/story. FB ids
  // show up as story_fbid=<id>, /posts/<id>, or pfbid… tokens.
  function extractPermalink(postEl) {
    const a =
      postEl.querySelector('a[href*="story_fbid="]') ||
      postEl.querySelector('a[href*="/posts/"]') ||
      postEl.querySelector('a[href*="/photo"]') ||
      postEl.querySelector('a[href*="/videos/"]');
    if (!a) return { postUrl: "", postId: "" };

    const href = a.getAttribute("href") || "";
    const postUrl = href.startsWith("http") ? href : location.origin + href;
    const m =
      href.match(/story_fbid=([^&]+)/) ||
      href.match(/\/posts\/([^/?]+)/) ||
      href.match(/(pfbid[\w]+)/);
    return { postUrl, postId: m ? m[1] : "" };
  }

  // Post text lives in the message data-attributes (reasonably stable) with a
  // dir="auto" fallback.
  function extractCaption(postEl) {
    const node =
      postEl.querySelector('[data-ad-preview="message"]') ||
      postEl.querySelector('[data-ad-comet-preview="message"]') ||
      postEl.querySelector('[data-testid="post_message"]');
    if (node && node.innerText.trim()) return node.innerText.trim();

    const auto = postEl.querySelector('div[dir="auto"]');
    return auto ? auto.innerText.trim() : "";
  }

  // Content images come from *.fbcdn.net. Filter out tiny chrome: emoji,
  // reaction icons, and profile thumbnails by requiring a reasonable size.
  function extractImageUrls(postEl) {
    const imgs = Array.from(postEl.querySelectorAll('img[src*="fbcdn.net"]'));
    const urls = imgs
      .filter((img) => {
        const src = img.currentSrc || img.src || "";
        if (/emoji|static|rsrc\.php/.test(src)) return false; // UI chrome
        const w = img.naturalWidth || img.width || 0;
        return w === 0 || w >= 200; // skip obvious thumbnails/avatars
      })
      .map((img) => img.currentSrc || img.src);
    return Array.from(new Set(urls));
  }

  function hasVideo(postEl) {
    return !!postEl.querySelector('video, [aria-label="Play"], [data-video-id]');
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

  // Anchor before the like/comment/share toolbar (a [role="group"] inside the
  // article). Fall back to appending to the article.
  function getActionAnchor(postEl) {
    const group = postEl.querySelector('[role="group"]');
    if (group && group.parentElement) {
      return { parent: group.parentElement, before: group };
    }
    return { parent: postEl, before: null };
  }

  g.VerilensAdapters = g.VerilensAdapters || {};
  g.VerilensAdapters.facebook = { findPosts, extractPostData, getActionAnchor };
})(globalThis);
