importScripts("../shared/lyrics-provider.js");

const cache = new Map();
const MAX_CACHE_ENTRIES = 100;

function createCacheKey(query) {
  const title = (query.title || "").toLowerCase().trim();
  const artist = (query.artist || "").toLowerCase().trim();
  return `${title}::${artist}`;
}

function setCacheValue(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FETCH_LYRICS") {
    return false;
  }

  const query = {
    title: message?.payload?.title || "",
    artist: message?.payload?.artist || ""
  };
  const cacheKey = createCacheKey(query);
  const cached = cache.get(cacheKey);
  if (cached) {
    sendResponse({ ok: true, data: cached, fromCache: true });
    return false;
  }

  (async () => {
    try {
      const data = await self.LyricsProvider.fetchSyncedLyrics(query);
      if (!data) {
        sendResponse({ ok: false, error: "NO_LYRICS_FOUND" });
        return;
      }
      setCacheValue(cacheKey, data);
      sendResponse({ ok: true, data, fromCache: false });
    } catch (_error) {
      sendResponse({ ok: false, error: "NETWORK_ERROR" });
    }
  })();

  return true;
});
