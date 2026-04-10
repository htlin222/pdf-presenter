import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type { ServerConfig, StartedServer, NotesDoc } from "./server/types.js";
import {
  MIME,
  EMPTY_NOTES,
  send,
  notFound,
  streamFile,
  contentTypeFor,
  isSafeFilename,
  readJsonBody,
  readBinaryBody,
} from "./server/http-utils.js";
import { resolveUiDir, resolvePdfjsDir } from "./server/paths.js";
import { renderHtml } from "./server/html-render.js";
import {
  validateNotesDoc,
  createNotesUpdater,
} from "./server/notes-store.js";

export type { ServerConfig, StartedServer } from "./server/types.js";

export async function startServer(config: ServerConfig): Promise<StartedServer> {
  const uiDir = resolveUiDir(import.meta.url);
  const pdfjsDir = resolvePdfjsDir(import.meta.url);

  const audienceHtml = await renderHtml(uiDir, "audience.html", config);
  const presenterHtml = await renderHtml(uiDir, "presenter.html", config);

  const updateNotes = createNotesUpdater(config.notesPath);

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (pathname === "/api/recording-meta" && method === "POST") {
        const filenameParam = url.searchParams.get("filename");
        if (!filenameParam) {
          send(
            res,
            400,
            JSON.stringify({ error: "filename query param required" }),
            MIME[".json"],
          );
          return;
        }
        if (!isSafeFilename(filenameParam)) {
          send(
            res,
            400,
            JSON.stringify({ error: "invalid filename" }),
            MIME[".json"],
          );
          return;
        }
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send(res, 400, JSON.stringify({ error: msg }), MIME[".json"]);
          return;
        }
        if (!body || typeof body !== "object") {
          send(
            res,
            400,
            JSON.stringify({ error: "body must be a JSON object" }),
            MIME[".json"],
          );
          return;
        }
        const pdfDir = dirname(config.pdfPath);
        const outDir = join(pdfDir, "recordings");
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
        return;
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
          return;
        }
        if (!isSafeFilename(filenameParam)) {
          send(
            res,
            400,
            JSON.stringify({ error: "invalid filename" }),
            MIME[".json"],
          );
          return;
        }
        let bytes: Buffer;
        try {
          bytes = await readBinaryBody(req);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send(res, 413, JSON.stringify({ error: msg }), MIME[".json"]);
          return;
        }
        if (bytes.length === 0) {
          send(
            res,
            400,
            JSON.stringify({ error: "empty recording body" }),
            MIME[".json"],
          );
          return;
        }
        const pdfDir = dirname(config.pdfPath);
        const outDir = join(pdfDir, "recordings");
        await mkdir(outDir, { recursive: true });
        const outPath = join(outDir, filenameParam);
        await writeFile(outPath, bytes);
        send(
          res,
          200,
          JSON.stringify({
            ok: true,
            path: outPath,
            bytes: bytes.length,
          }),
          MIME[".json"],
        );
        return;
      }

      if (pathname === "/api/notes-file" && (method === "PUT" || method === "POST")) {
        const body = (await readJsonBody(req)) as Partial<NotesDoc>;
        const validation = validateNotesDoc(body);
        if (!validation.ok) {
          send(
            res,
            400,
            JSON.stringify({ error: validation.error }),
            MIME[".json"],
          );
          return;
        }
        const incoming = validation.doc;
        await updateNotes(() => ({
          meta: {
            ...incoming.meta,
            generator: incoming.meta.generator ?? "pdf-presenter",
            lastEditedAt: new Date().toISOString(),
          } as NotesDoc["meta"] & { lastEditedAt?: string },
          notes: incoming.notes,
        }));
        send(
          res,
          200,
          JSON.stringify({
            ok: true,
            slideCount: Object.keys(incoming.notes).length,
          }),
          MIME[".json"],
        );
        return;
      }

      if (pathname === "/api/notes" && (method === "PUT" || method === "POST")) {
        const body = (await readJsonBody(req)) as {
          slide?: unknown;
          note?: unknown;
        };
        const slideRaw = body.slide;
        const note = body.note;
        const slideNum =
          typeof slideRaw === "number"
            ? slideRaw
            : typeof slideRaw === "string"
              ? Number.parseInt(slideRaw, 10)
              : NaN;
        if (!Number.isInteger(slideNum) || slideNum < 1) {
          send(
            res,
            400,
            JSON.stringify({ error: "slide must be a positive integer" }),
            MIME[".json"],
          );
          return;
        }
        if (typeof note !== "string") {
          send(
            res,
            400,
            JSON.stringify({ error: "note must be a string" }),
            MIME[".json"],
          );
          return;
        }
        const key = String(slideNum);
        await updateNotes((doc) => {
          const existing = doc.notes[key] ?? {};
          const nextNotes: NotesDoc["notes"] = {
            ...doc.notes,
            [key]: { hint: existing.hint ?? "", note },
          };
          const nextMeta: NotesDoc["meta"] = {
            generator: "pdf-presenter",
            ...doc.meta,
            lastEditedAt: new Date().toISOString(),
          } as NotesDoc["meta"] & { lastEditedAt?: string };
          return { meta: nextMeta, notes: nextNotes };
        });
        send(
          res,
          200,
          JSON.stringify({ ok: true, slide: slideNum }),
          MIME[".json"],
        );
        return;
      }

      if (pathname === "/" || pathname === "/audience") {
        send(res, 200, audienceHtml, MIME[".html"]);
        return;
      }
      if (pathname === "/presenter") {
        send(res, 200, presenterHtml, MIME[".html"]);
        return;
      }
      if (pathname === "/slides.pdf") {
        streamFile(res, config.pdfPath, "application/pdf");
        return;
      }
      if (pathname === "/notes.json") {
        if (existsSync(config.notesPath)) {
          streamFile(res, config.notesPath, MIME[".json"]);
        } else {
          send(res, 200, EMPTY_NOTES, MIME[".json"]);
        }
        return;
      }
      if (pathname.startsWith("/assets/pdfjs/")) {
        const rel = pathname.slice("/assets/pdfjs/".length);
        const safe = resolve(pdfjsDir, rel);
        if (!safe.startsWith(pdfjsDir + "/") && safe !== pdfjsDir) {
          send(res, 403, "Forbidden");
          return;
        }
        if (!existsSync(safe)) {
          notFound(res);
          return;
        }
        streamFile(res, safe, contentTypeFor(safe));
        return;
      }
      if (pathname.startsWith("/assets/")) {
        const rel = pathname.slice("/assets/".length);
        const safe = resolve(uiDir, rel);
        if (!safe.startsWith(uiDir + "/") && safe !== uiDir) {
          send(res, 403, "Forbidden");
          return;
        }
        if (!existsSync(safe)) {
          notFound(res);
          return;
        }
        streamFile(res, safe, contentTypeFor(safe));
        return;
      }
      notFound(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send(res, 500, `Internal Server Error: ${msg}`);
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end(`Internal Server Error: ${msg}`);
    });
  });

  await new Promise<void>((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", rejectP);
      resolveP();
    });
  });

  return {
    port: config.port,
    stop: () =>
      new Promise<void>((resolveP, rejectP) => {
        server.close((err) => (err ? rejectP(err) : resolveP()));
      }),
  };
}
