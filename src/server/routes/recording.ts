import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RouteResult } from "../types.js";
import {
  MIME,
  send,
  isSafeFilename,
  readJsonBody,
  readBinaryBody,
} from "../http-utils.js";

export interface RecordingRouteDeps {
  /** Used to derive the <pdfDir>/recordings/ output directory. */
  pdfPath: string;
}

/**
 * Handles recording upload endpoints:
 *   - POST /api/recording       → binary audio blob
 *   - POST /api/recording-meta  → JSON metadata sidecar
 *
 * Both accept a `filename` query parameter (validated with isSafeFilename)
 * and write to `<pdfDir>/recordings/<filename>`, creating the directory
 * on demand.
 */
export async function handleRecordingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: RecordingRouteDeps,
): Promise<RouteResult> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (pathname === "/api/recording-meta" && method === "POST") {
    const filenameParam = url.searchParams.get("filename");
    if (!filenameParam) {
      send(
        res,
        400,
        JSON.stringify({ error: "filename query param required" }),
        MIME[".json"],
      );
      return "handled";
    }
    if (!isSafeFilename(filenameParam)) {
      send(res, 400, JSON.stringify({ error: "invalid filename" }), MIME[".json"]);
      return "handled";
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send(res, 400, JSON.stringify({ error: msg }), MIME[".json"]);
      return "handled";
    }
    if (!body || typeof body !== "object") {
      send(
        res,
        400,
        JSON.stringify({ error: "body must be a JSON object" }),
        MIME[".json"],
      );
      return "handled";
    }
    const outDir = join(dirname(deps.pdfPath), "recordings");
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, filenameParam);
    const text = JSON.stringify(body, null, 2) + "\n";
    await writeFile(outPath, text, "utf8");
    send(
      res,
      200,
      JSON.stringify({
        ok: true,
        path: outPath,
        bytes: Buffer.byteLength(text),
      }),
      MIME[".json"],
    );
    return "handled";
  }

  if (pathname === "/api/recording" && method === "POST") {
    const filenameParam = url.searchParams.get("filename");
    if (!filenameParam) {
      send(
        res,
        400,
        JSON.stringify({ error: "filename query param required" }),
        MIME[".json"],
      );
      return "handled";
    }
    if (!isSafeFilename(filenameParam)) {
      send(res, 400, JSON.stringify({ error: "invalid filename" }), MIME[".json"]);
      return "handled";
    }
    let bytes: Buffer;
    try {
      bytes = await readBinaryBody(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send(res, 413, JSON.stringify({ error: msg }), MIME[".json"]);
      return "handled";
    }
    if (bytes.length === 0) {
      send(
        res,
        400,
        JSON.stringify({ error: "empty recording body" }),
        MIME[".json"],
      );
      return "handled";
    }
    const outDir = join(dirname(deps.pdfPath), "recordings");
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, filenameParam);
    await writeFile(outPath, bytes);
    send(
      res,
      200,
      JSON.stringify({ ok: true, path: outPath, bytes: bytes.length }),
      MIME[".json"],
    );
    return "handled";
  }

  return "pass";
}
