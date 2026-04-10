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

  // --- Notes editing state ---
  const SAVE_DEBOUNCE_MS = 600;
  let saveTimer = null;
  let pendingSlide = null; // slide whose note is waiting to be flushed
  let inflightSave = Promise.resolve();
  let suppressInput = false; // true while we programmatically set textarea value

  async function show(n) {
    const target = clampSlide(n, total);
    const slideChanged = target !== currentSlide;
    await flushPendingSave();
    currentSlide = target;
    counter.textContent = `${currentSlide} / ${total}`;
    loadNoteIntoEditor(currentSlide);
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

  function loadNoteIntoEditor(n) {
    const entry = notes[String(n)] || { hint: "", note: "" };
    suppressInput = true;
    notesBody.value = entry.note || "";
    suppressInput = false;
    notesHint.textContent = entry.hint ? `hint: ${entry.hint}` : "";
    setStatus("");
  }

  function setStatus(state) {
    notesStatus.classList.remove("saving", "saved", "error");
    if (state === "saving") {
      notesStatus.classList.add("saving");
      notesStatus.textContent = "Saving…";
    } else if (state === "saved") {
      notesStatus.classList.add("saved");
      notesStatus.textContent = "Saved";
    } else if (state === "error") {
      notesStatus.classList.add("error");
      notesStatus.textContent = "Save failed";
    } else {
      notesStatus.textContent = "";
    }
  }

  function scheduleSave() {
    if (suppressInput) return;
    pendingSlide = currentSlide;
    // Mirror into local cache so re-entering this slide shows the draft.
    const key = String(pendingSlide);
    const existing = notes[key] || { hint: "", note: "" };
    notes[key] = { hint: existing.hint || "", note: notesBody.value };
    setStatus("saving");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistPending();
    }, SAVE_DEBOUNCE_MS);
  }

  async function persistPending() {
    if (pendingSlide === null) return;
    const slide = pendingSlide;
    pendingSlide = null;
    const note = notes[String(slide)]?.note ?? "";
    inflightSave = inflightSave.then(async () => {
      try {
        const res = await fetch("/api/notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slide, note }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Only clear the indicator if nothing new was queued meanwhile.
        if (pendingSlide === null && !saveTimer) setStatus("saved");
      } catch {
        setStatus("error");
      }
    });
    await inflightSave;
  }

  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistPending();
    } else {
      await inflightSave;
    }
  }

  notesBody.addEventListener("input", scheduleSave);
  notesBody.addEventListener("blur", () => void flushPendingSave());

  // ---- Import / export ----
  const exportBtn = document.getElementById("export-notes");
  const loadBtn = document.getElementById("load-notes");
  const loadInput = document.getElementById("load-notes-input");
  const actionStatus = document.getElementById("notes-action-status");

  function setActionStatus(text, level) {
    actionStatus.classList.remove("ok", "error");
    if (level) actionStatus.classList.add(level);
    actionStatus.textContent = text || "";
    if (text) {
      setTimeout(() => {
        if (actionStatus.textContent === text) setActionStatus("");
      }, 3000);
    }
  }

  exportBtn.addEventListener("click", async () => {
    try {
      await flushPendingSave();
      const res = await fetch("/notes.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `speaker-notes-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setActionStatus("Exported", "ok");
    } catch (err) {
      setActionStatus(`Export failed: ${err.message || err}`, "error");
    }
  });

  loadBtn.addEventListener("click", () => loadInput.click());

  // ---- Audio recording ----
  const recordStartBtn = document.getElementById("record-start");
  const recordPauseBtn = document.getElementById("record-pause");
  const recordStopBtn = document.getElementById("record-stop");
  const recordElapsedEl = document.getElementById("record-elapsed");
  const recordLabelEl = document.getElementById("record-label");
  const recordIndicator = document.getElementById("record-indicator");
  const recordDialog = document.getElementById("record-dialog");
  const recordDialogFile = document.getElementById("record-dialog-file");
  const recordDialogRange = document.getElementById("record-dialog-range");
  const recordDialogDuration = document.getElementById("record-dialog-duration");
  const recordDialogSize = document.getElementById("record-dialog-size");
  const recordDialogSegments = document.getElementById("record-dialog-segments");
  const recordDialogError = document.getElementById("record-dialog-error");
  const recordDialogSave = document.getElementById("record-dialog-save");
  const recordDialogAbandon = document.getElementById("record-dialog-abandon");

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

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
      mediaRecorder = null;
      recordedChunks = [];
      recordingSegments = [];
      updateRecordUI("idle");
      openRecordingDialog(pendingRecording);
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

  function openRecordingDialog(rec) {
    recordDialogFile.textContent = rec.filename;
    recordDialogRange.textContent =
      rec.startSlide === rec.endSlide
        ? `slide ${rec.startSlide}`
        : `slides ${rec.startSlide} → ${rec.endSlide}`;
    recordDialogDuration.textContent = formatRecordElapsed(rec.durationMs);
    recordDialogSize.textContent = formatBytes(rec.blob.size);
    renderSegmentList(rec.segments);
    recordDialogError.classList.add("hidden");
    recordDialogError.textContent = "";
    recordDialogSave.disabled = false;
    recordDialogAbandon.disabled = false;
    recordDialog.classList.remove("hidden");
  }

  function renderSegmentList(segments) {
    recordDialogSegments.innerHTML = "";
    for (const seg of segments) {
      const li = document.createElement("li");
      const slide = document.createElement("span");
      slide.className = "seg-slide";
      slide.textContent = `p.${seg.slide}`;
      const range = document.createElement("span");
      range.className = "seg-range";
      range.textContent = `${formatTimeMs(seg.fromMs)} – ${formatTimeMs(seg.toMs)}`;
      const dur = document.createElement("span");
      dur.className = "seg-dur";
      dur.textContent = formatTimeMs(seg.toMs - seg.fromMs);
      li.appendChild(slide);
      li.appendChild(range);
      li.appendChild(dur);
      recordDialogSegments.appendChild(li);
    }
  }

  function closeRecordingDialog() {
    recordDialog.classList.add("hidden");
    pendingRecording = null;
  }

  async function saveRecording() {
    if (!pendingRecording) return;
    recordDialogSave.disabled = true;
    recordDialogAbandon.disabled = true;
    recordDialogError.classList.add("hidden");
    try {
      const audioRes = await fetch(
        `/api/recording?filename=${encodeURIComponent(pendingRecording.filename)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": pendingRecording.blob.type || "application/octet-stream",
          },
          body: pendingRecording.blob,
        },
      );
      if (!audioRes.ok) {
        const errBody = await audioRes.json().catch(() => ({}));
        throw new Error(errBody.error || `audio upload failed: HTTP ${audioRes.status}`);
      }
      const metadata = buildRecordingMetadata(pendingRecording);
      const metaRes = await fetch(
        `/api/recording-meta?filename=${encodeURIComponent(pendingRecording.metaFilename)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadata),
        },
      );
      if (!metaRes.ok) {
        const errBody = await metaRes.json().catch(() => ({}));
        throw new Error(
          `audio saved; metadata upload failed: ${errBody.error || `HTTP ${metaRes.status}`}`,
        );
      }
      closeRecordingDialog();
    } catch (err) {
      recordDialogError.textContent = `Save failed: ${err.message || err}`;
      recordDialogError.classList.remove("hidden");
      recordDialogSave.disabled = false;
      recordDialogAbandon.disabled = false;
    }
  }

  recordStartBtn.addEventListener("click", () => void startRecording());
  recordPauseBtn.addEventListener("click", togglePauseRecording);
  recordStopBtn.addEventListener("click", stopRecording);
  recordDialogSave.addEventListener("click", () => void saveRecording());
  recordDialogAbandon.addEventListener("click", closeRecordingDialog);

  updateRecordUI("idle");

  loadInput.addEventListener("change", async () => {
    const file = loadInput.files && loadInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("file is not valid JSON");
      }
      if (!parsed || typeof parsed !== "object" || !parsed.notes) {
        throw new Error("missing 'notes' field");
      }
      // Flush any in-flight edit for the current slide so it isn't overwritten
      // by the old in-memory state after reload.
      await flushPendingSave();
      const res = await fetch("/api/notes-file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      // Refresh local cache and reload the current slide's note into the editor.
      const refreshed = await loadNotes(config.notesUrl);
      const newNotes = (refreshed && refreshed.notes) || {};
      for (const key of Object.keys(notes)) delete notes[key];
      for (const [k, v] of Object.entries(newNotes)) notes[k] = v;
      loadNoteIntoEditor(currentSlide);
      setActionStatus(`Loaded (${Object.keys(newNotes).length} slides)`, "ok");
    } catch (err) {
      setActionStatus(`Load failed: ${err.message || err}`, "error");
    } finally {
      loadInput.value = "";
    }
  });

  window.addEventListener("beforeunload", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      // Best-effort sync send via sendBeacon.
      const slide = pendingSlide;
      if (slide !== null) {
        const payload = JSON.stringify({
          slide,
          note: notes[String(slide)]?.note ?? "",
        });
        try {
          navigator.sendBeacon(
            "/api/notes",
            new Blob([payload], { type: "application/json" }),
          );
        } catch {
          /* ignore */
        }
      }
    }
  });

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
    if (document.activeElement === notesBody) {
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
