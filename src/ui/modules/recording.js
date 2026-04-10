// Presenter audio recording subsystem.
//
// Wraps MediaRecorder, tracks a slide-change timeline so the user can tell
// which slide was on screen during which audio range, and hands finished
// recordings to a createRecordingDialog instance for save/abandon.
//
// Public API: { onSlideChanged(newSlide) } — orchestrator calls this from
// its show() function whenever the presenter advances or rewinds.

const TICK_INTERVAL_MS = 250;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
];

function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function formatTimeMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timestampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

export function createRecorder({
  config,
  getCurrentSlide,
  dialog,
  startBtn,
  pauseBtn,
  stopBtn,
  elapsedEl,
  labelEl,
  indicatorEl,
}) {
  let mediaRecorder = null;
  let recordedChunks = [];
  let startSlide = null;
  let startedAtIso = null;
  let elapsedMs = 0;
  let lastTickAt = 0;
  let tickHandle = null;
  // Segment timeline: each item is {slide, fromMs, toMs?}.
  // The last entry is the open segment (no toMs until closed).
  let segments = [];

  function pdfBaseName() {
    const name = config.pdfName || "slides.pdf";
    return name.replace(/\.pdf$/i, "");
  }

  function buildRecordingFilename(s, e) {
    // Honour the user-requested .mp3 naming convention regardless of the
    // actual container produced by MediaRecorder — browsers cannot emit MP3
    // natively. See README for details on transcoding if needed.
    return `${pdfBaseName()}_${s}_to_${e}_at_${timestampNow()}.mp3`;
  }

  function currentElapsedMsPrecise() {
    if (tickHandle !== null) {
      return elapsedMs + (Date.now() - lastTickAt);
    }
    return elapsedMs;
  }

  function closeOpenSegment(at) {
    const open = segments[segments.length - 1];
    if (open && open.toMs === undefined) open.toMs = at;
  }

  function onSlideChanged(newSlide) {
    // Only track slide changes while actively recording — paused time is
    // excluded so paused-nav doesn't pollute the timeline.
    if (!mediaRecorder || mediaRecorder.state !== "recording") return;
    const open = segments[segments.length - 1];
    if (!open || open.slide === newSlide) return;
    const at = currentElapsedMsPrecise();
    open.toMs = at;
    segments.push({ slide: newSlide, fromMs: at });
  }

  function buildMetadata(rec) {
    return {
      audio: rec.filename,
      pdf: config.pdfName || null,
      startedAt: startedAtIso,
      durationMs: rec.durationMs,
      duration: formatTimeMs(rec.durationMs),
      mimeType: rec.blob.type || "",
      segments: rec.segments.map((seg) => ({
        slide: seg.slide,
        fromMs: seg.fromMs,
        toMs: seg.toMs,
        from: formatTimeMs(seg.fromMs),
        to: formatTimeMs(seg.toMs),
      })),
    };
  }

  function updateUI(state) {
    if (state === "recording") {
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      pauseBtn.textContent = "Pause";
      stopBtn.disabled = false;
      indicatorEl.classList.add("active");
      indicatorEl.classList.remove("paused");
      labelEl.textContent = "Recording";
    } else if (state === "paused") {
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      pauseBtn.textContent = "Resume";
      stopBtn.disabled = false;
      indicatorEl.classList.remove("active");
      indicatorEl.classList.add("paused");
      labelEl.textContent = "Paused";
    } else {
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      pauseBtn.textContent = "Pause";
      stopBtn.disabled = true;
      indicatorEl.classList.remove("active", "paused");
      labelEl.textContent = "Audio";
      elapsedEl.textContent = "00:00";
    }
  }

  function startTicker() {
    lastTickAt = Date.now();
    if (tickHandle !== null) return;
    tickHandle = setInterval(() => {
      const now = Date.now();
      elapsedMs += now - lastTickAt;
      lastTickAt = now;
      elapsedEl.textContent = formatTimeMs(elapsedMs);
    }, TICK_INTERVAL_MS);
  }

  function stopTicker() {
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  async function start() {
    if (mediaRecorder) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      labelEl.textContent = "Mic denied";
      console.error("Microphone access denied:", err);
      return;
    }
    const mime = pickRecorderMime();
    try {
      mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      labelEl.textContent = "Unsupported";
      console.error("MediaRecorder init failed:", err);
      return;
    }
    recordedChunks = [];
    elapsedMs = 0;
    startSlide = getCurrentSlide();
    startedAtIso = new Date().toISOString();
    segments = [{ slide: startSlide, fromMs: 0 }];

    mediaRecorder.addEventListener("dataavailable", (ev) => {
      if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((t) => t.stop());
      const finalMs = currentElapsedMsPrecise();
      stopTicker();
      closeOpenSegment(finalMs);
      const endSlide = getCurrentSlide();
      const blob = new Blob(recordedChunks, {
        type: mediaRecorder.mimeType || mime || "audio/webm",
      });
      const filename = buildRecordingFilename(startSlide, endSlide);
      const pending = {
        blob,
        startSlide,
        endSlide,
        durationMs: finalMs,
        filename,
        metaFilename: filename.replace(/\.[^./\\]+$/, "") + ".meta.json",
        segments: segments.slice(),
      };
      pending.metadata = buildMetadata(pending);
      mediaRecorder = null;
      recordedChunks = [];
      segments = [];
      updateUI("idle");
      dialog.open(pending);
    });

    mediaRecorder.start(1000);
    updateUI("recording");
    startTicker();
  }

  function togglePause() {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === "recording") {
      // Close the open segment at the pause boundary so toMs reflects audio
      // time up to the pause; we'll re-open a fresh segment on resume.
      const at = currentElapsedMsPrecise();
      closeOpenSegment(at);
      mediaRecorder.pause();
      stopTicker();
      updateUI("paused");
    } else if (mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      startTicker();
      // Re-open a segment on whichever slide is currently on screen — if the
      // presenter navigated during the pause, this captures the new slide.
      const at = currentElapsedMsPrecise();
      segments.push({ slide: getCurrentSlide(), fromMs: at });
      updateUI("recording");
    }
  }

  function stop() {
    if (!mediaRecorder) return;
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  startBtn.addEventListener("click", () => void start());
  pauseBtn.addEventListener("click", togglePause);
  stopBtn.addEventListener("click", stop);

  updateUI("idle");

  return { onSlideChanged };
}
