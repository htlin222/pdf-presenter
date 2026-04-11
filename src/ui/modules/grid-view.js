// Grid view overlay: thumbnail grid for fast slide navigation.
// Thumbnails are rendered lazily on first open and cached for the session.
// Keyboard: arrow keys move selection, Enter picks, Esc closes.

// Render at 2x the min-column width so tiles stay crisp when the grid
// auto-expands columns wider than the minimum. Display size is driven
// by CSS (width:100%, height:auto), so the canvas keeps its natural ratio.
const THUMB_RENDER_WIDTH = 480;
const CONTAINER_ID = "grid-overlay";

export function createGridView({ pdf, total, getCurrentSlide, onSelect }) {
  let overlayEl = null;
  let gridEl = null;
  let tileEls = []; // index 0 => slide 1
  const thumbCache = new Map(); // pageNumber -> HTMLImageElement
  let selected = 1;
  let open = false;
  let renderToken = 0;
  let aspectsLoaded = false;

  // Pre-compute each page's aspect ratio and pin it onto the tile BEFORE
  // any images load. Without this, CSS Grid with definite-height container
  // recomputes row heights as images decode, shrinking tiles to squeeze all
  // rows into view. Fetching page viewports is cheap — no rendering, just
  // metadata from pdf.js.
  async function pinAspects() {
    if (aspectsLoaded) return;
    aspectsLoaded = true;
    const pagePromises = [];
    for (let i = 1; i <= total; i++) pagePromises.push(pdf.getPage(i));
    const pages = await Promise.all(pagePromises);
    for (let i = 0; i < pages.length; i++) {
      const vp = pages[i].getViewport({ scale: 1 });
      const wrap = tileEls[i].querySelector(".grid-thumb");
      wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
    }
  }

  function build() {
    overlayEl = document.createElement("div");
    overlayEl.id = CONTAINER_ID;
    overlayEl.className = "grid-overlay hidden";
    overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-modal", "true");
    overlayEl.setAttribute("aria-label", "Slide grid");

    const header = document.createElement("div");
    header.className = "grid-header";
    const title = document.createElement("div");
    title.className = "grid-title";
    title.textContent = "All Slides";
    const hint = document.createElement("div");
    hint.className = "grid-hint";
    hint.innerHTML =
      '<span>← ↑ → ↓</span> move <span>Enter</span> jump <span>Esc</span> close';
    header.appendChild(title);
    header.appendChild(hint);

    gridEl = document.createElement("div");
    gridEl.className = "grid-tiles";

    for (let i = 1; i <= total; i++) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "grid-tile";
      tile.dataset.slide = String(i);

      // Wrap content in a plain block div so the <button> itself never acts
      // as a flex/grid container — button UA styles collapse flex children
      // with percentage-width replaced elements in some browsers.
      const inner = document.createElement("div");
      inner.className = "grid-tile-inner";

      const canvasWrap = document.createElement("div");
      canvasWrap.className = "grid-thumb";

      const label = document.createElement("div");
      label.className = "grid-label";
      label.textContent = String(i);

      inner.appendChild(canvasWrap);
      inner.appendChild(label);
      tile.appendChild(inner);
      tile.addEventListener("click", () => pick(i));
      tile.addEventListener("mouseenter", () => setSelected(i, false));
      gridEl.appendChild(tile);
      tileEls.push(tile);
    }

    overlayEl.appendChild(header);
    overlayEl.appendChild(gridEl);
    overlayEl.addEventListener("click", (ev) => {
      if (ev.target === overlayEl) close();
    });
    document.body.appendChild(overlayEl);
  }

  async function renderThumb(pageNumber) {
    if (thumbCache.has(pageNumber)) return thumbCache.get(pageNumber);
    const page = await pdf.getPage(pageNumber);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = THUMB_RENDER_WIDTH / unscaled.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    // <img> is a proper replaced element — width:100% / height:auto always
    // yields the image's natural aspect ratio.
    const img = new Image(canvas.width, canvas.height);
    img.src = canvas.toDataURL("image/png");
    img.decoding = "async";
    img.alt = `Slide ${pageNumber}`;
    thumbCache.set(pageNumber, img);
    return img;
  }

  async function fillTiles() {
    const token = ++renderToken;
    // Render in two passes: selected tile first so it shows up instantly,
    // then the rest in order. Each await checks the token so a close()
    // during rendering aborts cleanly.
    const order = [selected];
    for (let i = 1; i <= total; i++) if (i !== selected) order.push(i);
    for (const n of order) {
      if (token !== renderToken) return;
      const tile = tileEls[n - 1];
      const wrap = tile.querySelector(".grid-thumb");
      if (wrap.firstChild) continue;
      try {
        const canvas = await renderThumb(n);
        if (token !== renderToken) return;
        if (!wrap.firstChild) wrap.appendChild(canvas);
      } catch {
        // ignore render failures — tile stays blank
      }
    }
  }

  function setSelected(n, scroll = true) {
    if (n < 1 || n > total) return;
    selected = n;
    for (const t of tileEls) t.classList.remove("selected");
    const tile = tileEls[n - 1];
    tile.classList.add("selected");
    if (scroll) tile.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function pick(n) {
    close();
    onSelect(n);
  }

  function columnsPerRow() {
    if (!gridEl || !tileEls.length) return 1;
    const first = tileEls[0].getBoundingClientRect();
    const gridRect = gridEl.getBoundingClientRect();
    const gapX = 12;
    const cols = Math.max(
      1,
      Math.floor((gridRect.width + gapX) / (first.width + gapX)),
    );
    return cols;
  }

  function onKey(ev) {
    if (!open) return;
    const cols = columnsPerRow();
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      pick(selected);
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      setSelected(Math.min(total, selected + 1));
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      setSelected(Math.max(1, selected - 1));
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setSelected(Math.min(total, selected + cols));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setSelected(Math.max(1, selected - cols));
    } else if (ev.key === "Home") {
      ev.preventDefault();
      setSelected(1);
    } else if (ev.key === "End") {
      ev.preventDefault();
      setSelected(total);
    }
  }

  function openView() {
    if (!overlayEl) build();
    open = true;
    overlayEl.classList.remove("hidden");
    setSelected(getCurrentSlide(), true);
    // Fire and forget — pins each tile's box geometry to its slide aspect,
    // then kicks off rendering. fillTiles runs in parallel; it's safe because
    // the tiles already exist and we only update wrap.style.aspectRatio.
    pinAspects().then(fillTiles);
    window.addEventListener("keydown", onKey, true);
  }

  function close() {
    if (!open) return;
    open = false;
    renderToken++;
    overlayEl.classList.add("hidden");
    window.removeEventListener("keydown", onKey, true);
  }

  return {
    open: openView,
    close,
    isOpen: () => open,
  };
}
