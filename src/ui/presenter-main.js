// Presenter view entry. Loaded via presenter.js barrel from presenter.html.
// This file is a thin orchestrator — all subsystem logic lives under
// ./modules/ and is composed here via factory functions.

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
import { createRecorder } from "./modules/recording.js";
import { createResizableLayout } from "./modules/resizable-layout.js";
import { createGridView } from "./modules/grid-view.js";
import { createCursorSync } from "./modules/cursor-sync.js";

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
  const pdfNameEl = document.getElementById("pdf-name");
  const gridBtn = document.getElementById("grid-btn");
  const cursorSyncBtn = document.getElementById("cursor-sync-btn");

  if (pdfNameEl && config.pdfName) {
    pdfNameEl.textContent = config.pdfName;
    pdfNameEl.title = config.pdfName;
  }

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
    if (slideChanged) recorder.onSlideChanged(currentSlide);
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

  const recorder = createRecorder({
    config,
    getCurrentSlide: () => currentSlide,
    dialog,
    startBtn: document.getElementById("record-start"),
    pauseBtn: document.getElementById("record-pause"),
    stopBtn: document.getElementById("record-stop"),
    elapsedEl: document.getElementById("record-elapsed"),
    labelEl: document.getElementById("record-label"),
    indicatorEl: document.getElementById("record-indicator"),
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
    if (editor.isFocused()) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        notesBody.blur();
      }
      return;
    }
    // Grid view owns the keyboard while open (arrows / Enter / Esc).
    if (gridView.isOpen()) return;
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
    } else if (ev.key === "g" || ev.key === "G") {
      ev.preventDefault();
      gridView.open();
    } else if (ev.key === "l" || ev.key === "L") {
      ev.preventDefault();
      cursorSync.toggle();
      updateCursorSyncBtn();
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

  // ---- Grid view ----
  const gridView = createGridView({
    pdf,
    total,
    getCurrentSlide: () => currentSlide,
    onSelect: (n) => show(n),
  });
  if (gridBtn) gridBtn.addEventListener("click", () => gridView.open());

  // ---- Cursor sync ----
  const cursorSync = createCursorSync({ canvas: currentCanvas, channel });
  function updateCursorSyncBtn() {
    if (!cursorSyncBtn) return;
    const on = cursorSync.isEnabled();
    cursorSyncBtn.textContent = `◉ Cursor sync: ${on ? "on" : "off"}`;
    cursorSyncBtn.setAttribute("aria-pressed", String(on));
    cursorSyncBtn.classList.toggle("active", on);
  }
  if (cursorSyncBtn) {
    cursorSyncBtn.addEventListener("click", () => {
      cursorSync.toggle();
      updateCursorSyncBtn();
    });
  }
  updateCursorSyncBtn();

  // ---- Resizable layout dividers ----
  createResizableLayout({
    layoutEl: document.querySelector(".layout"),
    colDividerEl: document.getElementById("divider-col"),
    leftColEl: document.querySelector(".col-left"),
    rowDividerLeftEl: document.getElementById("divider-row-left"),
    rightColEl: document.querySelector(".col-right"),
    rowDividerRightEl: document.getElementById("divider-row-right"),
    onResize: () => show(currentSlide),
  });

  await show(1);
}
