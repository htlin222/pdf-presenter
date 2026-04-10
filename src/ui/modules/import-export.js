// Presenter import / export subsystem.
// Wires the Export and Load buttons to /notes.json and /api/notes-file.
// Side-effect only — no return value.

import { loadNotes } from "./pdf-render.js";

const STATUS_TIMEOUT_MS = 3000;

export function wireImportExport({
  exportBtn,
  loadBtn,
  loadInput,
  statusEl,
  config,
  notesCache,
  flushPending,
  onLoaded,
}) {
  function setStatus(text, level) {
    statusEl.classList.remove("ok", "error");
    if (level) statusEl.classList.add(level);
    statusEl.textContent = text || "";
    if (text) {
      setTimeout(() => {
        if (statusEl.textContent === text) setStatus("");
      }, STATUS_TIMEOUT_MS);
    }
  }

  exportBtn.addEventListener("click", async () => {
    try {
      await flushPending();
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
      setStatus("Exported", "ok");
    } catch (err) {
      setStatus(`Export failed: ${err.message || err}`, "error");
    }
  });

  loadBtn.addEventListener("click", () => loadInput.click());

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
      await flushPending();
      const res = await fetch("/api/notes-file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      // Refresh local cache and hand control back to the orchestrator to
      // re-render the current slide's note in the editor.
      const refreshed = await loadNotes(config.notesUrl);
      const newNotes = (refreshed && refreshed.notes) || {};
      for (const key of Object.keys(notesCache)) delete notesCache[key];
      for (const [k, v] of Object.entries(newNotes)) notesCache[k] = v;
      onLoaded();
      setStatus(`Loaded (${Object.keys(newNotes).length} slides)`, "ok");
    } catch (err) {
      setStatus(`Load failed: ${err.message || err}`, "error");
    } finally {
      loadInput.value = "";
    }
  });
}
