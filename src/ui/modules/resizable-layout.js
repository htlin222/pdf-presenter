// Draggable split handles for the presenter layout.
//
// Three independent splits:
//   --col-left       : on layoutEl        — width of the left column
//   --row-top-left   : on leftColEl       — height of the current-slide row
//                                            inside the left column
//   --row-top-right  : on rightColEl      — height of the next-slide row
//                                            inside the right column
//
// Each is clamped to [MIN_PCT, MAX_PCT] so no pane can fully collapse,
// and persisted to localStorage so the split survives refreshes.

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
    if (!parsed || typeof parsed !== "object") return null;
    const col = clampPct(Number(parsed.colLeftPct));
    // Migrate an older single `rowTopPct` value into both left and right.
    const legacyRow = clampPct(Number(parsed.rowTopPct));
    const left = clampPct(Number(parsed.rowTopLeftPct));
    const right = clampPct(Number(parsed.rowTopRightPct));
    return {
      colLeftPct: col ?? DEFAULT_COL_LEFT_PCT,
      rowTopLeftPct: left ?? legacyRow ?? DEFAULT_ROW_TOP_PCT,
      rowTopRightPct: right ?? legacyRow ?? DEFAULT_ROW_TOP_PCT,
    };
  } catch {
    return null;
  }
}

export function createResizableLayout({
  layoutEl,
  colDividerEl,
  leftColEl,
  rowDividerLeftEl,
  rightColEl,
  rowDividerRightEl,
  onResize,
}) {
  const persisted = loadPersisted();
  let colLeftPct = persisted?.colLeftPct ?? DEFAULT_COL_LEFT_PCT;
  let rowTopLeftPct = persisted?.rowTopLeftPct ?? DEFAULT_ROW_TOP_PCT;
  let rowTopRightPct = persisted?.rowTopRightPct ?? DEFAULT_ROW_TOP_PCT;

  function apply() {
    layoutEl.style.setProperty("--col-left", `${colLeftPct}%`);
    leftColEl.style.setProperty("--row-top-left", `${rowTopLeftPct}%`);
    rightColEl.style.setProperty("--row-top-right", `${rowTopRightPct}%`);
  }

  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ colLeftPct, rowTopLeftPct, rowTopRightPct }),
      );
    } catch {
      /* storage disabled / quota — ignore */
    }
  }

  // Axis-agnostic drag: picks clientX/rect.width for "col", clientY/rect.height
  // for "row". `containerEl` is the element whose bounding box we measure —
  // for the col divider that's the whole layout, for a row divider that's
  // its own column container.
  function attachDrag({ dividerEl, containerEl, axis, get, set }) {
    dividerEl.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const rect = containerEl.getBoundingClientRect();
      const startValue = get();
      const startX = ev.clientX;
      const startY = ev.clientY;
      dividerEl.classList.add("dragging");
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      function onMove(mev) {
        const next =
          axis === "col"
            ? clampPct(startValue + ((mev.clientX - startX) / rect.width) * 100)
            : clampPct(startValue + ((mev.clientY - startY) / rect.height) * 100);
        if (next !== null) {
          set(next);
          apply();
        }
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        dividerEl.classList.remove("dragging");
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        persist();
        if (typeof onResize === "function") onResize();
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  attachDrag({
    dividerEl: colDividerEl,
    containerEl: layoutEl,
    axis: "col",
    get: () => colLeftPct,
    set: (v) => {
      colLeftPct = v;
    },
  });
  attachDrag({
    dividerEl: rowDividerLeftEl,
    containerEl: leftColEl,
    axis: "row",
    get: () => rowTopLeftPct,
    set: (v) => {
      rowTopLeftPct = v;
    },
  });
  attachDrag({
    dividerEl: rowDividerRightEl,
    containerEl: rightColEl,
    axis: "row",
    get: () => rowTopRightPct,
    set: (v) => {
      rowTopRightPct = v;
    },
  });

  apply();
}
