import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * Load an HTML file from `uiDir` and inject runtime config by replacing
 * the `<!--PDF_PRESENTER_CONFIG-->` marker with a JSON script element.
 */
export async function renderHtml(
  uiDir: string,
  file: string,
  meta: Record<string, unknown>,
): Promise<string> {
  const raw = await readFile(join(uiDir, file), "utf8");
  return raw.replace(
    "<!--PDF_PRESENTER_CONFIG-->",
    `<script id="pdf-presenter-config" type="application/json">${JSON.stringify(meta)}</script>`,
  );
}

/** Build the standard meta object for a single-PDF server config. */
export function singlePdfMeta(config: {
  pdfPath: string;
  timerMinutes?: number;
}): Record<string, unknown> {
  return {
    pdfUrl: "/slides.pdf",
    notesUrl: "/notes.json",
    pdfName: basename(config.pdfPath),
    timerMinutes: config.timerMinutes ?? null,
  };
}
