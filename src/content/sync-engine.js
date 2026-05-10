class LyricsSyncEngine {
  constructor(video, lines, onLineChange) {
    this.video = video;
    this.lines = lines || [];
    this.onLineChange = onLineChange;
    this.activeIndex = -1;
    this.lastTickTime = 0;
    this.minTickInterval = 120;
    this.frameHandle = null;
    this.lastVideoTimeMs = 0;
    this.running = false;
    this.boundTick = this.tick.bind(this);
    this._offsetMs = 0;
  }

  setOffset(ms) {
    this._offsetMs = typeof ms === "number" ? ms : 0;
  }

  setLines(lines) {
    this.lines = lines || [];
    this.reset();
  }

  reset() {
    this.activeIndex = -1;
    this.lastVideoTimeMs = Math.max(0, Math.floor(this.video.currentTime * 1000));
    this.lastTickTime = 0;
  }

  findActiveLineIndex(currentMs) {
    if (!this.lines.length) {
      return -1;
    }

    const adjustedMs = currentMs + this._offsetMs;

    let low = 0;
    let high = this.lines.length - 1;
    let candidate = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.lines[mid].startMs <= adjustedMs) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (candidate < 0) {
      return -1;
    }

    const line = this.lines[candidate];
    if (typeof line.endMs === "number" && adjustedMs >= line.endMs) {
      return -1;
    }

    return candidate;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.tick(performance.now());
  }

  stop() {
    this.running = false;
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  tick(now) {
    if (!this.running) {
      return;
    }

    const elapsedSinceLastTick = now - this.lastTickTime;
    if (elapsedSinceLastTick >= this.minTickInterval) {
      this.lastTickTime = now;

      const currentMs = Math.max(0, Math.floor(this.video.currentTime * 1000));
      const seekJumpMs = Math.abs(currentMs - this.lastVideoTimeMs);
      const isLargeSeek = seekJumpMs > 8000;
      if (isLargeSeek) {
        this.activeIndex = -1;
      }
      this.lastVideoTimeMs = currentMs;

      if (!this.video.paused && !this.video.ended && seekJumpMs >= 0) {
        const nextIndex = this.findActiveLineIndex(currentMs);
        if (nextIndex !== this.activeIndex) {
          this.activeIndex = nextIndex;
          this.onLineChange(nextIndex, { currentMs, seekJumpMs });
        }
      }
    }

    this.frameHandle = requestAnimationFrame(this.boundTick);
  }
}

window.LyricsSyncEngine = LyricsSyncEngine;
