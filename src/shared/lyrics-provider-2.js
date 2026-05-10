const LRCLIB_ENDPOINT = "https://lrclib.net/api/get";

function parseLrcTimestampToMs(rawTimestamp) {
  const match = rawTimestamp.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fractionRaw = match[3] || "0";
  const fractionMs = Number(fractionRaw.padEnd(3, "0").slice(0, 3));

  return (minutes * 60 + seconds) * 1000 + fractionMs;
}

function parseSyncedLyrics(syncedLyrics) {
  if (!syncedLyrics || typeof syncedLyrics !== "string") {
    return [];
  }

  const lines = [];
  const rawLines = syncedLyrics.split(/\r?\n/);
  const regex = /^\[([^\]]+)\](.*)$/;

  for (const rawLine of rawLines) {
    const match = rawLine.match(regex);
    if (!match) {
      continue;
    }

    const startMs = parseLrcTimestampToMs(match[1].trim());
    const text = match[2].trim();
    if (startMs === null || !text) {
      continue;
    }

    lines.push({ startMs, endMs: undefined, text });
  }

  lines.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < lines.length - 1; i += 1) {
    lines[i].endMs = lines[i + 1].startMs;
  }

  return lines;
}

function uniquePreserveOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}

function stripYoutubeNoise(title) {
  let value = (title || "").trim();
  if (!value) {
    return "";
  }

  value = value
    .replace(/\[(official|lyrics?|lyric video|audio|music video|mv|hd|4k|visualizer)[^\]]*\]/gi, "")
    .replace(/\((official|lyrics?|lyric video|audio|music video|mv|hd|4k|visualizer)[^)]*\)/gi, "")
    .replace(/\s*-\s*(official|lyrics?|lyric video|audio|music video|mv|hd|4k|visualizer).*$/gi, "")
    .replace(/\s*\|\s*(official|lyrics?|lyric video|audio|music video|mv|hd|4k|visualizer).*$/gi, "")
    .replace(/\s+(ft\.?|feat\.?|featuring)\s+.+$/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return value;
}

function buildTitleCandidates(cleanTitle) {
  const titleWithoutSuffix = cleanTitle.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  const titleAfterDash = cleanTitle.split("-").slice(-1)[0].trim() || cleanTitle;
  const titleBeforePipe = cleanTitle.split("|")[0].trim();
  const titleBeforeBullet = cleanTitle.split("•")[0].trim();
  const youtubeNoiseStripped = stripYoutubeNoise(cleanTitle);
  const youtubeNoiseAfterDash = stripYoutubeNoise(titleAfterDash);
  const youtubeNoiseBeforePipe = stripYoutubeNoise(titleBeforePipe);
  const colonTail = cleanTitle.split(":").slice(-1)[0].trim() || cleanTitle;

  return uniquePreserveOrder([
    cleanTitle,
    titleWithoutSuffix,
    titleAfterDash,
    titleBeforePipe,
    titleBeforeBullet,
    youtubeNoiseStripped,
    youtubeNoiseAfterDash,
    youtubeNoiseBeforePipe,
    colonTail,
    stripYoutubeNoise(colonTail)
  ]);
}

function buildQueryVariants({ title, artist }) {
  const cleanTitle = (title || "").trim();
  const cleanArtist = (artist || "").trim();
  const titleCandidates = buildTitleCandidates(cleanTitle);

  const variants = [];
  for (const candidateTitle of titleCandidates) {
    variants.push({ title: candidateTitle, artist: cleanArtist });
  }

  const deduped = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = `${variant.title.toLowerCase()}::${variant.artist.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(variant);
  }
  return deduped;
}

async function fetchFromLrcLib(query) {
  const url = new URL(LRCLIB_ENDPOINT);
  url.searchParams.set("track_name", query.title);
  if (query.artist) {
    url.searchParams.set("artist_name", query.artist);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const lines = parseSyncedLyrics(payload?.syncedLyrics || "");
  if (!lines.length) {
    return null;
  }

  return {
    source: "lrclib",
    lines,
    plainLyrics: payload?.plainLyrics || ""
  };
}

async function fetchSyncedLyrics(query) {
  const variants = buildQueryVariants(query);
  for (const variant of variants) {
    try {
      const result = await fetchFromLrcLib(variant);
      if (result) {
        return result;
      }
    } catch (_error) {
      // Try next variant.
    }
  }

  return null;
}

self.LyricsProvider = {
  fetchSyncedLyrics
};
