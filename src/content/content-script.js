(() => {
  const OVERLAY_ID = "yt-lyrics-overlay-root";
  const PANEL_ID = "yt-lyrics-overlay-panel";
  const SESSION_STORAGE_KEY = "yt_lyrics_overlay_settings";
  const DEBUG_LOGS = false;
  const METADATA_STABILITY_POLLS = 2;
  const METADATA_STABILITY_INTERVAL_MS = 150;
  const ROUTE_DEBOUNCE_MS = 220;
  const MAX_TRACK_RETRIES = 3;
  const RETRY_BACKOFF_MS = 1200;

  let currentVideo = null;
  let currentLines = [];
  let syncEngine = null;
  let routeObserver = null;
  let routeDebounceTimer = null;
  let activeRequestToken = 0;
  const attachedVideoListeners = new WeakSet();
  const lifecycle = {
    activeVideoId: "",
    activeMetaKey: "",
    lyricState: "idle",
    retryCount: 0,
    nextRetryAtMs: 0
  };

  const state = {
    opacity: 0.85,
    fontScale: 1,
    visible: true,
    dragging: false,
    resizing: false,
    offsetX: 40,
    offsetY: 40,
    width: 360,
    height: 320,
    timestampOffset: 0,
    controlsOpen: false
  };

  function getVideoId() {
    const url = new URL(window.location.href);
    return url.searchParams.get("v") || "";
  }

  function debugLog(...args) {
    if (!DEBUG_LOGS) {
      return;
    }
    console.debug("[yt-lyrics]", ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extractMetadata() {
    const titleNode = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
    const channelNode = document.querySelector("#owner #channel-name a");
    const rawTitle = titleNode?.textContent?.trim() || document.title.replace(" - YouTube", "");
    const channelName = channelNode?.textContent?.trim() || "";

    let artist = channelName;
    let title = rawTitle;

    if (rawTitle.includes("-")) {
      const parts = rawTitle.split("-").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        artist = parts[0];
        title = parts.slice(1).join(" - ");
      }
    }

    return { title, artist };
  }

  function metadataKey(metadata) {
    return `${(metadata.artist || "").trim().toLowerCase()}::${(metadata.title || "").trim().toLowerCase()}`;
  }

  function getRootContainer() {
    const player = document.querySelector("#movie_player");
    if (!player) {
      return null;
    }

    let root = document.getElementById(OVERLAY_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = OVERLAY_ID;
      player.appendChild(root);
    } else if (root.parentElement !== player) {
      player.appendChild(root);
    }
    return root;
  }

  function saveState() {
    const persist = {
      opacity: state.opacity,
      fontScale: state.fontScale,
      visible: state.visible,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      width: state.width,
      height: state.height,
      controlsOpen: state.controlsOpen
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(persist));
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
      Object.assign(state, parsed);
      if (typeof state.controlsOpen !== "boolean") {
        state.controlsOpen = false;
      }
    } catch (_error) {
      // Ignore malformed local state.
    }
  }

  function updatePanelStyle(panel) {
    panel.style.opacity = `${state.opacity}`;
    panel.style.left = `${state.offsetX}px`;
    panel.style.top = `${state.offsetY}px`;
    panel.style.width = `${state.width}px`;
    panel.style.height = `${state.height}px`;
    panel.style.display = state.visible ? "flex" : "none";
    panel.style.setProperty("--lyrics-font-scale", `${state.fontScale}`);
  }

  function createOverlayUi() {
    const root = getRootContainer();
    if (!root) {
      return null;
    }

    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      return existing;
    }

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "yt-lyrics-panel";
    panel.innerHTML = `
      <header class="yt-lyrics-header">
        <div class="yt-lyrics-header-title">
          <div class="yt-lyrics-title">Lyrics</div>
          <button type="button" class="yt-lyrics-toggle-btn" data-action="toggle-controls" title="Toggle settings">&#9654;</button>
        </div>
        <div class="yt-lyrics-controls">
          <label class="yt-lyrics-offset-wrap" title="Shift lyric timestamps (ms). Negative = lyrics later, Positive = lyrics earlier.">
            <span>Offset</span>
            <input data-action="offset" type="number" step="100" min="-60000" max="60000" value="0">
          </label>
          <button type="button" data-action="decrease-font" title="Smaller text">A-</button>
          <button type="button" data-action="increase-font" title="Larger text">A+</button>
          <label class="yt-lyrics-opacity-wrap" title="Opacity">
            <span>Opacity</span>
            <input data-action="opacity" type="range" min="0.35" max="1" step="0.05">
          </label>
          <button type="button" data-action="hide" title="Hide overlay">Hide</button>
        </div>
      </header>
      <div class="yt-lyrics-body">
        <div class="yt-lyrics-status" data-role="status">Loading synced lyrics...</div>
        <ol class="yt-lyrics-lines" data-role="lines"></ol>
      </div>
      <button class="yt-lyrics-resize-handle" data-action="resize" aria-label="Resize lyrics panel"></button>
    `;

    panel.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) {
        return;
      }

      const action = target.getAttribute("data-action");
      if (action === "increase-font") {
        state.fontScale = Math.min(1.8, +(state.fontScale + 0.1).toFixed(2));
      } else if (action === "decrease-font") {
        state.fontScale = Math.max(0.7, +(state.fontScale - 0.1).toFixed(2));
      } else if (action === "hide") {
        state.visible = false;
      } else if (action === "toggle-controls") {
        state.controlsOpen = !state.controlsOpen;
        const controls = panel.querySelector(".yt-lyrics-controls");
        const toggleBtn = panel.querySelector('[data-action="toggle-controls"]');
        if (controls) controls.classList.toggle("open", state.controlsOpen);
        if (toggleBtn) toggleBtn.classList.toggle("expanded", state.controlsOpen);
        saveState();
      }
      updatePanelStyle(panel);
      saveState();
    });

    const opacityInput = panel.querySelector('input[data-action="opacity"]');
    opacityInput.value = String(state.opacity);
    opacityInput.addEventListener("input", () => {
      state.opacity = Number(opacityInput.value);
      updatePanelStyle(panel);
      saveState();
    });

    const offsetInput = panel.querySelector('input[data-action="offset"]');
    offsetInput.value = String(state.timestampOffset);
    offsetInput.addEventListener("input", () => {
      const raw = Number(offsetInput.value);
      const clamped = Math.max(-60000, Math.min(60000, isNaN(raw) ? 0 : raw));
      state.timestampOffset = clamped;
      if (syncEngine) {
        syncEngine.setOffset(clamped);
      }
      offsetInput.value = String(clamped);
    });

    const controls = panel.querySelector(".yt-lyrics-controls");
    const toggleBtn = panel.querySelector('[data-action="toggle-controls"]');
    if (controls) controls.classList.toggle("open", state.controlsOpen);
    if (toggleBtn) toggleBtn.classList.toggle("expanded", state.controlsOpen);

    const header = panel.querySelector(".yt-lyrics-header");
    let dragStart = null;
    header.addEventListener("mousedown", (event) => {
      if (event.target.closest("[data-action]")) {
        return;
      }
      state.dragging = true;
      dragStart = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: state.offsetX,
        offsetY: state.offsetY
      };
      event.preventDefault();
    });

    const resizeHandle = panel.querySelector('[data-action="resize"]');
    let resizeStart = null;
    resizeHandle.addEventListener("mousedown", (event) => {
      state.resizing = true;
      resizeStart = {
        startX: event.clientX,
        startY: event.clientY,
        width: state.width,
        height: state.height
      };
      event.preventDefault();
    });

    document.addEventListener("mousemove", (event) => {
      if (state.dragging && dragStart) {
        state.offsetX = Math.max(0, dragStart.offsetX + (event.clientX - dragStart.startX));
        state.offsetY = Math.max(0, dragStart.offsetY + (event.clientY - dragStart.startY));
        updatePanelStyle(panel);
      } else if (state.resizing && resizeStart) {
        state.width = Math.max(260, resizeStart.width + (event.clientX - resizeStart.startX));
        state.height = Math.max(180, resizeStart.height + (event.clientY - resizeStart.startY));
        updatePanelStyle(panel);
      }
    });

    document.addEventListener("mouseup", () => {
      if (state.dragging || state.resizing) {
        state.dragging = false;
        state.resizing = false;
        saveState();
      }
    });

    root.appendChild(panel);
    updatePanelStyle(panel);
    return panel;
  }

  function setStatus(text, isError) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    const statusNode = panel.querySelector('[data-role="status"]');
    statusNode.textContent = text;
    statusNode.style.display = "block";
    statusNode.classList.toggle("is-error", Boolean(isError));
    panel.querySelector('[data-role="lines"]').style.display = "none";
  }

  function clearRenderedLyrics() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    const list = panel.querySelector('[data-role="lines"]');
    list.innerHTML = "";
    list.style.display = "none";
  }

  function renderLines(lines) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    const list = panel.querySelector('[data-role="lines"]');
    const statusNode = panel.querySelector('[data-role="status"]');
    list.innerHTML = "";

    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const item = document.createElement("li");
      item.className = "yt-lyrics-line";
      item.textContent = line.text;
      fragment.appendChild(item);
    }

    list.appendChild(fragment);
    list.scrollTop = 0;
    statusNode.style.display = "none";
    list.style.display = "block";
  }

  function centerLineInList(list, item) {
    if (!list || !item) {
      return;
    }
    const lineCenter = item.offsetTop + item.offsetHeight / 2;
    const target = lineCenter - list.clientHeight / 2;
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    const clampedTarget = Math.max(0, Math.min(target, maxScrollTop));

    if (typeof list.scrollTo === "function") {
      list.scrollTo({ top: clampedTarget, behavior: "smooth" });
      return;
    }
    list.scrollTop = clampedTarget;
  }

  function setActiveLine(index) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !panel.isConnected) {
      return;
    }
    const list = panel.querySelector('[data-role="lines"]');
    if (!list) {
      return;
    }
    const items = list.querySelectorAll(".yt-lyrics-line");
    if (!items.length) {
      return;
    }
    items.forEach((item, itemIndex) => {
      item.classList.toggle("active", itemIndex === index);
    });

    if (index >= 0 && items[index]) {
      centerLineInList(list, items[index]);
    }
  }

  function requestLyrics(metadata) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "FETCH_LYRICS", payload: metadata },
          (response) => {
            if (chrome.runtime.lastError) {
              const message = chrome.runtime.lastError.message || "UNKNOWN_ERROR";
              debugLog("sendMessage lastError", message);
              const code = message.includes("context invalidated")
                ? "CONTEXT_INVALIDATED"
                : "RUNTIME_ERROR";
              resolve({ ok: false, error: code });
              return;
            }
            resolve(response || { ok: false, error: "EMPTY_RESPONSE" });
          }
        );
      } catch (_error) {
        resolve({ ok: false, error: "CONTEXT_INVALIDATED" });
      }
    });
  }

  function buildFallbackMessage(errorCode) {
    if (errorCode === "NO_LYRICS_FOUND") {
      return "No synced lyrics found for this track.";
    }
    if (errorCode === "CONTEXT_INVALIDATED") {
      return "Extension reloaded. Refresh this tab once.";
    }
    return "Network error while loading lyrics. Try again on next video.";
  }

  function trackKey(videoId, metaKey) {
    return `${videoId}::${metaKey}`;
  }

  function stopSyncEngine() {
    syncEngine?.stop();
    syncEngine = null;
  }

  function resetForNewTrack(videoId, metaKey) {
    debugLog("resetForNewTrack", videoId, metaKey);
    lifecycle.activeVideoId = videoId;
    lifecycle.activeMetaKey = metaKey;
    lifecycle.lyricState = "loading";
    lifecycle.retryCount = 0;
    lifecycle.nextRetryAtMs = 0;
    state.timestampOffset = 0;
    currentLines = [];
    clearRenderedLyrics();
    stopSyncEngine();
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      const offsetInput = panel.querySelector('input[data-action="offset"]');
      if (offsetInput) offsetInput.value = "0";
    }
    setStatus("Loading synced lyrics...", false);
  }

  async function waitForStableMetadata() {
    let stableMetadata = extractMetadata();
    for (let i = 0; i < METADATA_STABILITY_POLLS; i += 1) {
      await sleep(METADATA_STABILITY_INTERVAL_MS);
      const nextMetadata = extractMetadata();
      const currentKey = metadataKey(stableMetadata);
      const nextKey = metadataKey(nextMetadata);
      if (currentKey && currentKey === nextKey) {
        return nextMetadata;
      }
      stableMetadata = nextMetadata;
    }
    return stableMetadata;
  }

  function attachVideoListeners(video) {
    if (attachedVideoListeners.has(video)) {
      return;
    }
    attachedVideoListeners.add(video);

    video.addEventListener("seeked", () => {
      if (syncEngine) {
        syncEngine.reset();
      }
    });
    video.addEventListener("play", () => syncEngine?.start());
    video.addEventListener("pause", () => setActiveLine(syncEngine?.activeIndex ?? -1));
  }

  async function bootstrapForCurrentVideo() {
    if (!window.location.href.includes("youtube.com/watch")) {
      return;
    }

    const video = document.querySelector("video");
    if (!video) {
      setTimeout(bootstrapForCurrentVideo, 500);
      return;
    }

    currentVideo = video;
    const panel = createOverlayUi();
    if (!panel) {
      return;
    }

    const currentVideoId = getVideoId();
    if (!currentVideoId) {
      return;
    }

    const metadata = await waitForStableMetadata();
    const nextMetaKey = metadataKey(metadata);
    if (!nextMetaKey) {
      return;
    }

    const nextTrackKey = trackKey(currentVideoId, nextMetaKey);
    const activeTrackKey = trackKey(lifecycle.activeVideoId, lifecycle.activeMetaKey);
    const isNewTrack = nextTrackKey !== activeTrackKey;

    if (isNewTrack) {
      resetForNewTrack(currentVideoId, nextMetaKey);
    } else if (
      lifecycle.lyricState === "ready" ||
      lifecycle.lyricState === "loading" ||
      lifecycle.lyricState === "noLyrics"
    ) {
      return;
    } else if (lifecycle.lyricState === "error") {
      const now = Date.now();
      if (lifecycle.retryCount >= MAX_TRACK_RETRIES) {
        return;
      }
      if (now < lifecycle.nextRetryAtMs) {
        return;
      }
      lifecycle.lyricState = "loading";
      setStatus("Retrying lyrics fetch...", false);
    } else {
      lifecycle.lyricState = "loading";
      setStatus("Loading synced lyrics...", false);
    }

    const requestToken = ++activeRequestToken;
    const requestVideoId = currentVideoId;
    const requestMetaKey = nextMetaKey;
    debugLog("requestLyrics", requestVideoId, requestMetaKey, requestToken);
    const response = await requestLyrics(metadata);

    if (requestToken !== activeRequestToken) {
      debugLog("ignore stale token", requestToken, activeRequestToken);
      return;
    }

    const currentTrackKey = trackKey(lifecycle.activeVideoId, lifecycle.activeMetaKey);
    const requestedTrackKey = trackKey(requestVideoId, requestMetaKey);
    if (currentTrackKey !== requestedTrackKey) {
      debugLog("ignore stale track", requestedTrackKey, currentTrackKey);
      return;
    }

    if (!response?.ok || !response?.data?.lines?.length) {
      const sameTrackRefreshFailure =
        !isNewTrack && lifecycle.lyricState === "ready" && currentLines.length;
      if (sameTrackRefreshFailure) {
        debugLog("same track refresh failure, keep lines");
        return;
      }

      lifecycle.lyricState = response?.error === "NO_LYRICS_FOUND" ? "noLyrics" : "error";
      clearRenderedLyrics();
      stopSyncEngine();
      currentLines = [];
      if (lifecycle.lyricState === "noLyrics") {
        lifecycle.retryCount = MAX_TRACK_RETRIES;
        lifecycle.nextRetryAtMs = Number.MAX_SAFE_INTEGER;
        setStatus("No synced lyrics found for this track.", true);
      } else {
        lifecycle.retryCount += 1;
        if (lifecycle.retryCount >= MAX_TRACK_RETRIES) {
          setStatus("Could not load lyrics for this track. Please try next song.", true);
          lifecycle.nextRetryAtMs = Number.MAX_SAFE_INTEGER;
        } else {
          lifecycle.nextRetryAtMs = Date.now() + RETRY_BACKOFF_MS * lifecycle.retryCount;
          setStatus(buildFallbackMessage(response?.error), true);
        }
      }
      if (lifecycle.retryCount <= MAX_TRACK_RETRIES && lifecycle.lyricState === "error") {
        debugLog("retry scheduled", lifecycle.retryCount, lifecycle.nextRetryAtMs);
      }
      return;
    }

    currentLines = response.data.lines;
    lifecycle.lyricState = "ready";
    lifecycle.retryCount = 0;
    lifecycle.nextRetryAtMs = 0;
    renderLines(currentLines);
    stopSyncEngine();
    syncEngine = new window.LyricsSyncEngine(video, currentLines, (index) => {
      if (!document.hidden) {
        setActiveLine(index);
      }
    });
    syncEngine.setOffset(state.timestampOffset);
    syncEngine.reset();

    attachVideoListeners(video);
    syncEngine.start();
  }

  function mountShowButton() {
    if (document.getElementById("yt-lyrics-show-btn")) {
      return;
    }

    const button = document.createElement("button");
    button.id = "yt-lyrics-show-btn";
    button.className = "yt-lyrics-show-btn";
    button.textContent = "Show Lyrics";
    button.addEventListener("click", () => {
      state.visible = true;
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        updatePanelStyle(panel);
      }
      saveState();
    });
    document.body.appendChild(button);
  }

  function startRouteWatcher() {
    if (routeObserver) {
      return;
    }

    let lastHref = location.href;
    routeObserver = setInterval(() => {
      if (lastHref !== location.href) {
        lastHref = location.href;
        if (routeDebounceTimer) {
          clearTimeout(routeDebounceTimer);
        }
        routeDebounceTimer = setTimeout(() => {
          bootstrapForCurrentVideo();
        }, ROUTE_DEBOUNCE_MS);
        return;
      }
      bootstrapForCurrentVideo();
    }, 500);

    document.addEventListener("yt-navigate-finish", () => {
      if (routeDebounceTimer) {
        clearTimeout(routeDebounceTimer);
      }
      routeDebounceTimer = setTimeout(() => {
        bootstrapForCurrentVideo();
      }, ROUTE_DEBOUNCE_MS);
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!syncEngine) {
      return;
    }
    if (document.hidden) {
      syncEngine.stop();
    } else {
      syncEngine.start();
    }
  });

  function init() {
    loadState();
    mountShowButton();
    bootstrapForCurrentVideo();
    startRouteWatcher();
  }

  init();
})();
