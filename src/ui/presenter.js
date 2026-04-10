// Entry module loaded by both audience.html and presenter.html.
// Re-exports initAudience from ./audience.js and keeps initPresenter inline
// until it is extracted in a later refactor step.

import {
  CHANNEL_NAME,
  readConfig,
  loadDocument,
  loadNotes,
  renderPage,
  clampSlide,
} from "./modules/pdf-render.js";
import { createTimer } from "./modules/timer.js";
import { createNotesEditor } from "./modules/notes-editor.js";
import { wireImportExport } from "./modules/import-export.js";
import { createRecordingDialog } from "./modules/recording-dialog.js";

export { initAudience } from "./audience.js";

/* ==========================================================================
   Presenter view
   ========================================================================== */

export async function initPresenter() {
  const config = readConfig();
  const pdf = await loadDocument(config.pdfUrl);
  const total = pdf.numPages;
  const notesFile = await loadNotes(config.notesUrl);
  const notes = (notesFile && notesFile.notes) || {};

  const currentCanvas = document.getElementById("current-canvas");
  const nextCanvas = document.getElementById("next-canvas");
  const notesBody = document.getElementById("notes-body");
  const notesStatus = document.getElementById("notes-status");
  const notesHint = document.getElementById("notes-hint");
  const counter = document.getElementById("counter");
  const timerEl = document.getElementById("timer");

  const channel = new BroadcastChannel(CHANNEL_NAME);
  let currentSlide = 1;
  let frozen = false;
  let blackedOut = false;

  const editor = createNotesEditor({
    notesBody,
    statusEl: notesStatus,
    hintEl: notesHint,
    notesCache: notes,
    getCurrentSlide: () => currentSlide,
  });

  async function show(n) {
    const target = clampSlide(n, total);
    const slideChanged = target !== currentSlide;
    await editor.flushPending();
    currentSlide = target;
    counter.textContent = `${currentSlide} / ${total}`;
    editor.loadForSlide(currentSlide);
    if (slideChanged) noteSlideChangeForRecording(currentSlide);
    await Promise.all([
      renderPage(pdf, currentSlide, currentCanvas),
      currentSlide < total
        ? renderPage(pdf, currentSlide + 1, nextCanvas)
        : clearNext(),
    ]);
    channel.postMessage({ type: "slide", slide: currentSlide });
  }

  function clearNext() {
    const ctx = nextCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  }

  // ---- Import / export ----
  wireImportExport({
    exportBtn: document.getElementById("export-notes"),
    loadBtn: document.getElementById("load-notes"),
    loadInput: document.getElementById("load-notes-input"),
    statusEl: document.getElementById("notes-action-status"),
    config,
    notesCache: notes,
    flushPending: editor.flushPending,
    onLoaded: () => editor.loadForSlide(currentSlide),
  });

  // ---- Audio recording ----
  const recordStartBtn = document.getElementById("record-start");
  const recordPauseBtn = document.getElementById("record-pause");
  const recordStopBtn = document.getElementById("record-stop");
  const recordElapsedEl = document.getElementById("record-elapsed");
  const recordLabelEl = document.getElementById("record-label");
  const recordIndicator = document.getElementById("record-indicator");

  const dialog = createRecordingDialog({
    dialogEl: document.getElementById("record-dialog"),
    fileEl: document.getElementById("record-dialog-file"),
    rangeEl: document.getElementById("record-dialog-range"),
    durationEl: document.getElementById("record-dialog-duration"),
    sizeEl: document.getElementById("record-dialog-size"),
    segmentsEl: document.getElementById("record-dialog-segments"),
    errorEl: document.getElementById("record-dialog-error"),
    saveBtn: document.getElementById("record-dialog-save"),
    abandonBtn: document.getElementById("record-dialog-abandon"),
  });

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStartSlide = null;
  let recordingStartedAtIso = null;
  let recordingElapsedMs = 0;
  let recordingLastTickAt = 0;
  let recordingTickHandle = null;
  let pendingRecording = null;
  // Segment timeline: each item is {slide, fromMs, toMs?}.
  // The last entry is the open segment (no toMs until closed).
  let recordingSegments = [];

  function currentElapsedMsPrecise() {
    if (recordingTickHandle !== null) {
      return recordingElapsedMs + (Date.now() - recordingLastTickAt);
    }
    return recordingElapsedMs;
  }

  function noteSlideChangeForRecording(newSlide) {
    // Only track slide changes while actively recording — paused time is
    // excluded so paused-nav doesn't pollute the timeline.
    if (!mediaRecorder || mediaRecorder.state !== "recording") return;
    const open = recordingSegments[recordingSegments.length - 1];
    if (!open || open.slide === newSlide) return;
    const at = currentElapsedMsPrecise();
    open.toMs = at;
    recordingSegments.push({ slide: newSlide, fromMs: at });
  }

  function closeOpenSegment(at) {
    const open = recordingSegments[recordingSegments.length - 1];
    if (open && open.toMs === undefined) open.toMs = at;
  }

  function formatTimeMs(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function buildRecordingMetadata(rec) {
    return {
      audio: rec.filename,
      pdf: config.pdfName || null,
      startedAt: recordingStartedAtIso,
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

  function pickRecorderMime() {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/mpeg",
    ];
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c)) return c;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function formatRecordElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function pdfBaseName() {
    const name = config.pdfName || "slides.pdf";
    return name.replace(/\.pdf$/i, "");
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

  function buildRecordingFilename(startSlide, endSlide) {
    // Honour the user-requested .mp3 naming convention regardless of the
    // actual container produced by MediaRecorder — browsers cannot emit MP3
    // natively. See README for details on transcoding if needed.
    return `${pdfBaseName()}_${startSlide}_to_${endSlide}_at_${timestampNow()}.mp3`;
  }

  function updateRecordUI(state) {
    // state: 'idle' | 'recording' | 'paused'
    if (state === "recording") {
      recordStartBtn.disabled = true;
      recordPauseBtn.disabled = false;
      recordPauseBtn.textContent = "Pause";
      recordStopBtn.disabled = false;
      recordIndicator.classList.add("active");
      recordIndicator.classList.remove("paused");
      recordLabelEl.textContent = "Recording";
    } else if (state === "paused") {
      recordStartBtn.disabled = true;
      recordPauseBtn.disabled = false;
      recordPauseBtn.textContent = "Resume";
      recordStopBtn.disabled = false;
      recordIndicator.classList.remove("active");
      recordIndicator.classList.add("paused");
      recordLabelEl.textContent = "Paused";
    } else {
      recordStartBtn.disabled = false;
      recordPauseBtn.disabled = true;
      recordPauseBtn.textContent = "Pause";
      recordStopBtn.disabled = true;
      recordIndicator.classList.remove("active", "paused");
      recordLabelEl.textContent = "Audio";
      recordElapsedEl.textContent = "00:00";
    }
  }

  function startRecordingTicker() {
    recordingLastTickAt = Date.now();
    if (recordingTickHandle !== null) return;
    recordingTickHandle = setInterval(() => {
      const now = Date.now();
      recordingElapsedMs += now - recordingLastTickAt;
      recordingLastTickAt = now;
      recordElapsedEl.textContent = formatRecordElapsed(recordingElapsedMs);
    }, 250);
  }

  function stopRecordingTicker() {
    if (recordingTickHandle !== null) {
      clearInterval(recordingTickHandle);
      recordingTickHandle = null;
    }
  }

  async function startRecording() {
    if (mediaRecorder) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      recordLabelEl.textContent = "Mic denied";
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
      recordLabelEl.textContent = "Unsupported";
      console.error("MediaRecorder init failed:", err);
      return;
    }
    recordedChunks = [];
    recordingElapsedMs = 0;
    recordingStartSlide = currentSlide;
    recordingStartedAtIso = new Date().toISOString();
    recordingSegments = [{ slide: currentSlide, fromMs: 0 }];

    mediaRecorder.addEventListener("dataavailable", (ev) => {
      if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((t) => t.stop());
      const finalMs = currentElapsedMsPrecise();
      stopRecordingTicker();
      closeOpenSegment(finalMs);
      const endSlide = currentSlide;
      const blob = new Blob(recordedChunks, {
        type: mediaRecorder.mimeType || mime || "audio/webm",
      });
      const filename = buildRecordingFilename(recordingStartSlide, endSlide);
      pendingRecording = {
        blob,
        startSlide: recordingStartSlide,
        endSlide,
        durationMs: finalMs,
        filename,
        metaFilename: filename.replace(/\.[^./\\]+$/, "") + ".meta.json",
        segments: recordingSegments.slice(),
      };
      pendingRecording.metadata = buildRecordingMetadata(pendingRecording);
      mediaRecorder = null;
      recordedChunks = [];
      recordingSegments = [];
      updateRecordUI("idle");
      dialog.open(pendingRecording);
    });

    mediaRecorder.start(1000);
    updateRecordUI("recording");
    startRecordingTicker();
  }

  function togglePauseRecording() {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === "recording") {
      // Close the open segment at the pause boundary so toMs reflects audio
      // time up to the pause; we'll re-open a fresh segment on resume.
      const at = currentElapsedMsPrecise();
      closeOpenSegment(at);
      mediaRecorder.pause();
      stopRecordingTicker();
      updateRecordUI("paused");
    } else if (mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      startRecordingTicker();
      // Re-open a segment on whichever slide is currently on screen — if the
      // presenter navigated during the pause, this captures the new slide.
      const at = currentElapsedMsPrecise();
      recordingSegments.push({ slide: currentSlide, fromMs: at });
      updateRecordUI("recording");
    }
  }

  function stopRecording() {
    if (!mediaRecorder) return;
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  recordStartBtn.addEventListener("click", () => void startRecording());
  recordPauseBtn.addEventListener("click", togglePauseRecording);
  recordStopBtn.addEventListener("click", stopRecording);

  updateRecordUI("idle");

  function toggleFreeze() {
    frozen = !frozen;
    channel.postMessage({ type: "freeze", value: frozen });
  }

  function toggleBlack() {
    blackedOut = !blackedOut;
    channel.postMessage({ type: "black", value: blackedOut });
  }

  window.addEventListener("keydown", (ev) => {
    // When the notes editor is focused, let keys behave normally — but give
    // Escape as an explicit way to leave the editor and return to slide nav.
    if (editor.isFocused()) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        notesBody.blur();
      }
      return;
    }
    if (ev.key === "ArrowRight" || ev.key === "PageDown" || ev.key === " ") {
      ev.preventDefault();
      show(currentSlide + 1);
    } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
      ev.preventDefault();
      show(currentSlide - 1);
    } else if (ev.key === "Home") {
      show(1);
    } else if (ev.key === "End") {
      show(total);
    } else if (ev.key === "f" || ev.key === "F") {
      toggleFreeze();
    } else if (ev.key === "b" || ev.key === "B") {
      toggleBlack();
    } else if (ev.key === "r" || ev.key === "R") {
      timer.reset();
    }
  });

  window.addEventListener("resize", () => show(currentSlide));

  // ---- Timer ----
  const timerResetBtn = document.getElementById("timer-reset");
  const countdownMs =
    typeof config.timerMinutes === "number" && config.timerMinutes > 0
      ? config.timerMinutes * 60 * 1000
      : null;
  const timer = createTimer({ timerEl, resetBtnEl: timerResetBtn, countdownMs });

  await show(1);
}
