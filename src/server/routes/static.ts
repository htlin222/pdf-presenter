import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RouteResult } from "../types.js";
import {
  MIME,
  EMPTY_NOTES,
  send,
  notFound,
  streamFile,
  contentTypeFor,
} from "../http-utils.js";

export interface StaticRouteDeps {
  audienceHtml: string;
  presenterHtml: string;
  pdfPath: string;
  notesPath: string;
  uiDir: string;
  pdfjsDir: string;
}

/**
 * Handles all read-only routes:
 *   - GET /                       → audience HTML (pre-rendered)
 *   - GET /audience               → audience HTML
 *   - GET /presenter              → presenter HTML (pre-rendered)
 *   - GET /slides.pdf             → the PDF file, streamed
 *   - GET /notes.json             → the notes file (or an empty stub)
 *   - GET /assets/pdfjs/*         → pdfjs-dist library files
 *   - GET /assets/*               → UI assets under src/ui/ (incl. modules/)
 *
 * Path-traversal guards reject anything that escapes the uiDir or pdfjsDir
 * roots.
 */
export async function handleStaticRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: StaticRouteDeps,
): Promise<RouteResult> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  // Only GET (and implicit HEAD) should reach static content. Anything
  // else falls through to let a later handler or the 404 fallback own it.
  if (method !== "GET" && method !== "HEAD") return "pass";

  if (pathname === "/" || pathname === "/audience") {
    send(res, 200, deps.audienceHtml, MIME[".html"]);
    return "handled";
  }
  if (pathname === "/presenter") {
    send(res, 200, deps.presenterHtml, MIME[".html"]);
    return "handled";
  }
  if (pathname === "/slides.pdf") {
    streamFile(res, deps.pdfPath, "application/pdf");
    return "handled";
  }
  if (pathname === "/notes.json") {
    if (existsSync(deps.notesPath)) {
      streamFile(res, deps.notesPath, MIME[".json"]);
    } else {
      send(res, 200, EMPTY_NOTES, MIME[".json"]);
    }
    return "handled";
  }
  if (pathname.startsWith("/assets/pdfjs/")) {
    const rel = pathname.slice("/assets/pdfjs/".length);
    const safe = resolve(deps.pdfjsDir, rel);
    if (!safe.startsWith(deps.pdfjsDir + "/") && safe !== deps.pdfjsDir) {
      send(res, 403, "Forbidden");
      return "handled";
    }
    if (!existsSync(safe)) {
      notFound(res);
      return "handled";
    }
    streamFile(res, safe, contentTypeFor(safe));
    return "handled";
  }
  if (pathname.startsWith("/assets/")) {
    const rel = pathname.slice("/assets/".length);
    const safe = resolve(deps.uiDir, rel);
    if (!safe.startsWith(deps.uiDir + "/") && safe !== deps.uiDir) {
      send(res, 403, "Forbidden");
      return "handled";
    }
    if (!existsSync(safe)) {
      notFound(res);
      return "handled";
    }
    streamFile(res, safe, contentTypeFor(safe));
    return "handled";
  }
  return "pass";
}
