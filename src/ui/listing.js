/** @typedef {{ pdfName: string; hasNotes: boolean; filledCount: number; totalSlides: number }} PdfStatus */

function readConfig() {
  const el = document.getElementById("pdf-presenter-config");
  return el ? JSON.parse(el.textContent) : {};
}

/** @param {PdfStatus} s */
function badgeHtml(s) {
  if (!s.hasNotes) return `<span class="badge badge-none">No notes</span>`;
  if (s.filledCount === 0) return `<span class="badge badge-empty">Empty template</span>`;
  if (s.filledCount >= s.totalSlides) return `<span class="badge badge-ready">Ready</span>`;
  return `<span class="badge badge-partial">${s.filledCount}/${s.totalSlides}</span>`;
}

/** @param {PdfStatus} s */
function cardHtml(s) {
  const encoded = encodeURIComponent(s.pdfName);
  const slides = s.totalSlides > 0 ? `<span class="slide-count">${s.totalSlides} slides</span>` : "";
  return `<div class="pdf-card">
    <span class="pdf-name" title="${s.pdfName}">${s.pdfName}</span>
    ${badgeHtml(s)}
    ${slides}
    <span class="actions">
      <a class="btn btn-primary" href="/pdf/${encoded}/presenter">Open</a>
      <a class="btn" href="/pdf/${encoded}/">Audience</a>
    </span>
  </div>`;
}

export async function initListing() {
  const config = readConfig();
  const dirEl = document.getElementById("dir-path");
  if (dirEl && config.dirName) dirEl.textContent = config.dirName;

  const listEl = document.getElementById("list");
  try {
    const res = await fetch("/api/listing");
    /** @type {PdfStatus[]} */
    const pdfs = await res.json();
    if (pdfs.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No PDF files found in this directory.</div>`;
      return;
    }
    listEl.innerHTML = pdfs.map(cardHtml).join("");
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Failed to load listing: ${err.message}</div>`;
  }
}
