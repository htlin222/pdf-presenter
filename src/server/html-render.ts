import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ServerConfig } from "./types.js";

/**
 * Load an HTML file from `uiDir` and inject the presenter runtime config
 * by replacing the `<!--PDF_PRESENTER_CONFIG-->` marker. The injected
 * `<script id="pdf-presenter-config" type="application/json">` is read
 * by the frontend via readConfig().
 */
export async function renderHtml(
  uiDir: string,
  file: "audience.html" | "presenter.html",
  config: ServerConfig,
): Promise<string> {
  const raw = await readFile(join(uiDir, file), "utf8");
  const meta = {
    pdfUrl: "/slides.pdf",
    notesUrl: "/notes.json",
    pdfName: basename(config.pdfPath),
    timerMinutes: config.timerMinutes ?? null,
  };
  return raw.replace(
    "<!--PDF_PRESENTER_CONFIG-->",
    `<script id="pdf-presenter-config" type="application/json">${JSON.stringify(meta)}</script>`,
  );
}
