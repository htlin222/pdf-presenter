import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname } from "node:path";

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

export const EMPTY_NOTES = JSON.stringify(
  { meta: { totalSlides: 0, generator: "pdf-presenter" }, notes: {} },
  null,
  2,
);

export const MAX_JSON_BODY = 1_000_000; // 1 MB cap on edit payloads
export const MAX_RECORDING_BODY = 500 * 1024 * 1024; // 500 MB cap on audio uploads

export function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType = "text/plain; charset=utf-8",
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

export function notFound(res: ServerResponse): void {
  send(res, 404, "Not Found");
}

export function streamFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
): void {
  try {
    const st = statSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(st.size),
      "Cache-Control": "no-store",
    });
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) notFound(res);
      else res.end();
    });
    stream.pipe(res);
  } catch {
    notFound(res);
  }
}

export function contentTypeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function isSafeFilename(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name === "." || name === "..") return false;
  return true;
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveP, rejectP) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY) {
        rejectP(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolveP(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        rejectP(err);
      }
    });
    req.on("error", rejectP);
  });
}

export async function readBinaryBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveP, rejectP) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RECORDING_BODY) {
        rejectP(new Error("recording exceeds 500 MB limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveP(Buffer.concat(chunks)));
    req.on("error", rejectP);
  });
}
