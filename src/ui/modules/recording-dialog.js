// Presenter recording save/abandon dialog.
// The recorder calls open(rec) after MediaRecorder stops; this module
// handles the modal UI and the two POST uploads (audio + metadata).
//
// rec shape: {
//   blob:          Blob,
//   startSlide:    number,
//   endSlide:      number,
//   durationMs:    number,
//   filename:      string,
//   metaFilename:  string,
//   segments:      [{slide, fromMs, toMs}, ...],
//   metadata:      object  // serializable sidecar document
// }

function formatTimeMs(ms) {
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

export function createRecordingDialog({
  dialogEl,
  fileEl,
  rangeEl,
  durationEl,
  sizeEl,
  segmentsEl,
  errorEl,
  saveBtn,
  abandonBtn,
}) {
  let pending = null;

  function renderSegmentList(segments) {
    segmentsEl.innerHTML = "";
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
      segmentsEl.appendChild(li);
    }
  }

  function open(rec) {
    pending = rec;
    fileEl.textContent = rec.filename;
    rangeEl.textContent =
      rec.startSlide === rec.endSlide
        ? `slide ${rec.startSlide}`
        : `slides ${rec.startSlide} → ${rec.endSlide}`;
    durationEl.textContent = formatTimeMs(rec.durationMs);
    sizeEl.textContent = formatBytes(rec.blob.size);
    renderSegmentList(rec.segments);
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    saveBtn.disabled = false;
    abandonBtn.disabled = false;
    dialogEl.classList.remove("hidden");
  }

  function close() {
    dialogEl.classList.add("hidden");
    pending = null;
  }

  async function save() {
    if (!pending) return;
    saveBtn.disabled = true;
    abandonBtn.disabled = true;
    errorEl.classList.add("hidden");
    try {
      const audioRes = await fetch(
        `/api/recording?filename=${encodeURIComponent(pending.filename)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": pending.blob.type || "application/octet-stream",
          },
          body: pending.blob,
        },
      );
      if (!audioRes.ok) {
        const errBody = await audioRes.json().catch(() => ({}));
        throw new Error(errBody.error || `audio upload failed: HTTP ${audioRes.status}`);
      }
      const metaRes = await fetch(
        `/api/recording-meta?filename=${encodeURIComponent(pending.metaFilename)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending.metadata),
        },
      );
      if (!metaRes.ok) {
        const errBody = await metaRes.json().catch(() => ({}));
        throw new Error(
          `audio saved; metadata upload failed: ${errBody.error || `HTTP ${metaRes.status}`}`,
        );
      }
      close();
    } catch (err) {
      errorEl.textContent = `Save failed: ${err.message || err}`;
      errorEl.classList.remove("hidden");
      saveBtn.disabled = false;
      abandonBtn.disabled = false;
    }
  }

  saveBtn.addEventListener("click", () => void save());
  abandonBtn.addEventListener("click", close);

  return { open, close };
}
