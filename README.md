# YouTube Lyrics Overlay (MVP)

Chrome extension that overlays synced lyrics on `youtube.com/watch` videos and highlights the current line as playback progresses.

## Load locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select this project folder.

## MVP features

- Injects a lyrics panel over the YouTube player.
- Fetches synced lyrics from LRCLIB via background service worker.
- Auto-highlights and auto-scrolls based on the video `currentTime`.
- Supports YouTube SPA navigation (`yt-navigate-finish` and URL changes).
- Includes basic overlay controls: hide/show, opacity, font size, drag, resize.

## QA checklist run

- `manifest.json` validates for MV3 structure and script wiring.
- JavaScript syntax checks pass for:
  - `src/background/service-worker.js`
  - `src/content/content-script.js`
  - `src/content/sync-engine.js`
- Error states implemented:
  - no lyrics found
  - network error

## Regression checklist (stability)

- Reload extension while a YouTube watch tab is open:
  - verify no uncaught crash from `chrome.runtime.sendMessage`
  - verify fallback status prompts a tab refresh if context invalidates
- Navigate next/previous songs in same tab:
  - previous lyrics must be cleared immediately on track change
  - no stale lyric carryover while waiting for new fetch
- Validate missing-lyrics behavior:
  - if a track has no synced lyrics, show `No synced lyrics found for this track`
  - ensure old track lyrics are not reused
- Validate track with lyrics after a no-lyrics track:
  - new lyrics must load and sync without manual page refresh
- Validate overlay layout resilience:
  - header controls stay visible at small panel sizes
  - resize handle does not block list scrollbar area
- Validate sync behavior:
  - seek forward/back updates highlighted line correctly
  - large seeks reset active selection without breaking playback updates

## Known limitations (expected in MVP)

- Lyrics availability depends on LRCLIB coverage.
- Artist/title extraction from YouTube metadata is heuristic and may miss edge cases.
- No manual timing offset controls yet.
- No support for `music.youtube.com` yet.
