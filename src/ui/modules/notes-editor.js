// Presenter notes editor subsystem.
// Debounced auto-save to PUT /api/notes, best-effort sendBeacon on unload,
// and a public API that the orchestrator calls when the slide changes.
//
// The caller owns `notesCache` (plain object indexed by slide key). This
// module mutates it on every edit so the orchestrator's in-memory view
// stays in sync with what the user has typed.

const SAVE_DEBOUNCE_MS = 600;

export function createNotesEditor({
  notesBody,
  statusEl,
  hintEl,
  notesCache,
  getCurrentSlide,
}) {
  let saveTimer = null;
  let pendingSlide = null; // slide whose note is waiting to be flushed
  let inflightSave = Promise.resolve();
  let suppressInput = false; // true while we programmatically set textarea value

  function loadForSlide(n) {
    const entry = notesCache[String(n)] || { hint: "", note: "" };
    suppressInput = true;
    notesBody.value = entry.note || "";
    suppressInput = false;
    hintEl.textContent = entry.hint ? `hint: ${entry.hint}` : "";
    setStatus("");
  }

  function setStatus(state) {
    statusEl.classList.remove("saving", "saved", "error");
    if (state === "saving") {
      statusEl.classList.add("saving");
      statusEl.textContent = "Saving…";
    } else if (state === "saved") {
      statusEl.classList.add("saved");
      statusEl.textContent = "Saved";
    } else if (state === "error") {
      statusEl.classList.add("error");
      statusEl.textContent = "Save failed";
    } else {
      statusEl.textContent = "";
    }
  }

  function scheduleSave() {
    if (suppressInput) return;
    pendingSlide = getCurrentSlide();
    // Mirror into local cache so re-entering this slide shows the draft.
    const key = String(pendingSlide);
    const existing = notesCache[key] || { hint: "", note: "" };
    notesCache[key] = { hint: existing.hint || "", note: notesBody.value };
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
    const note = notesCache[String(slide)]?.note ?? "";
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

  async function flushPending() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistPending();
    } else {
      await inflightSave;
    }
  }

  function isFocused() {
    return document.activeElement === notesBody;
  }

  notesBody.addEventListener("input", scheduleSave);
  notesBody.addEventListener("blur", () => void flushPending());

  window.addEventListener("beforeunload", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      // Best-effort sync send via sendBeacon (POST-only, server accepts both
      // PUT and POST on /api/notes for exactly this case).
      const slide = pendingSlide;
      if (slide !== null) {
        const payload = JSON.stringify({
          slide,
          note: notesCache[String(slide)]?.note ?? "",
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

  return { loadForSlide, flushPending, isFocused };
}
