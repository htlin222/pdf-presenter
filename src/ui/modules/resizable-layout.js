// Draggable vertical and horizontal split handles for the presenter layout.
// Drives two CSS custom properties on layoutEl:
//   --col-left : percentage width of the left column (current + notes)
//   --row-top  : percentage height of the top row (current + next)
// Both are clamped to [MIN_PCT, MAX_PCT] so neither panel can fully collapse.
// Persisted to localStorage so the user's split survives refreshes.

const STORAGE_KEY = "pdf-presenter-layout";
const MIN_PCT = 20;
const MAX_PCT = 85;
const DEFAULT_COL_LEFT_PCT = 66;
const DEFAULT_ROW_TOP_PCT = 60;

function clampPct(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_PCT, Math.min(MAX_PCT, n));
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const col = clampPct(Number(parsed.colLeftPct));
    const row = clampPct(Number(parsed.rowTopPct));
    if (col === null || row === null) return null;
    return { colLeftPct: col, rowTopPct: row };
  } catch {
    return null;
  }
}

export function createResizableLayout({
  layoutEl,
  colDividerEl,
  rowDividerEl,
  onResize,
}) {
  const persisted = loadPersisted();
  let colLeftPct = persisted?.colLeftPct ?? DEFAULT_COL_LEFT_PCT;
  let rowTopPct = persisted?.rowTopPct ?? DEFAULT_ROW_TOP_PCT;

  function apply() {
    layoutEl.style.setProperty("--col-left", `${colLeftPct}%`);
    layoutEl.style.setProperty("--row-top", `${rowTopPct}%`);
  }

  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ colLeftPct, rowTopPct }),
      );
    } catch {
      /* storage disabled / quota — ignore */
    }
  }

  function beginDrag(ev, axis) {
    ev.preventDefault();
    const rect = layoutEl.getBoundingClientRect();
    const startCol = colLeftPct;
    const startRow = rowTopPct;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const divider = axis === "col" ? colDividerEl : rowDividerEl;
    divider.classList.add("dragging");
    const prevBodyCursor = document.body.style.cursor;
    const prevBodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    function onMove(mev) {
      if (axis === "col") {
        const dx = mev.clientX - startX;
        const next = clampPct(startCol + (dx / rect.width) * 100);
        if (next !== null) colLeftPct = next;
      } else {
        const dy = mev.clientY - startY;
        const next = clampPct(startRow + (dy / rect.height) * 100);
        if (next !== null) rowTopPct = next;
      }
      apply();
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      divider.classList.remove("dragging");
      document.body.style.cursor = prevBodyCursor;
      document.body.style.userSelect = prevBodyUserSelect;
      persist();
      // Re-render the canvases at the new parent size for crisp pixels.
      if (typeof onResize === "function") onResize();
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  colDividerEl.addEventListener("mousedown", (ev) => beginDrag(ev, "col"));
  rowDividerEl.addEventListener("mousedown", (ev) => beginDrag(ev, "row"));

  apply();
}
