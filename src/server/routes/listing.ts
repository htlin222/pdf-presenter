import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteResult } from "../types.js";
import { MIME, send } from "../http-utils.js";
import { listPdfsInDirectory, getPdfNotesStatus } from "../../utils.js";

export interface ListingRouteDeps {
  dirPath: string;
  listingHtml: string;
}

/**
 * Handles directory listing routes:
 *   - GET /  or  GET /list  → listing HTML page
 *   - GET /api/listing      → JSON array of PdfNotesStatus
 */
export async function handleListingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: ListingRouteDeps,
): Promise<RouteResult> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return "pass";

  if (pathname === "/" || pathname === "/list") {
    send(res, 200, deps.listingHtml, MIME[".html"]);
    return "handled";
  }

  if (pathname === "/api/listing") {
    const pdfNames = listPdfsInDirectory(deps.dirPath);
    const statuses = pdfNames.map((name) =>
      getPdfNotesStatus(deps.dirPath, name),
    );
    send(res, 200, JSON.stringify(statuses), MIME[".json"]);
    return "handled";
  }

  return "pass";
}
