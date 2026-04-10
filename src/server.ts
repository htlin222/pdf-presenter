import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { basename, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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

export type { ServerConfig, StartedServer } from "./server/types.js";

function resolveUiDir(): string {
  // When bundled, this file becomes dist/pdf-presenter.js.
  // When running via tsx (dev/tests), this file is src/server.ts.
  // In both cases, ../src/ui and ./ui resolve relative to siblings.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../src/ui"), // published layout: dist/ → ../src/ui
    resolve(here, "./ui"), // dev: src/ → ./ui
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Could not locate UI assets (looked in: ${candidates.join(", ")})`);
}

function resolvePdfjsDir(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("pdfjs-dist/package.json");
  return dirname(pkgJson);
}

function validateNotesDoc(
  raw: unknown,
):
  | { ok: true; doc: NotesDoc }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = raw as { meta?: unknown; notes?: unknown };
  if (obj.notes === undefined || obj.notes === null) {
    return { ok: false, error: "missing 'notes' field" };
  }
  if (typeof obj.notes !== "object" || Array.isArray(obj.notes)) {
    return { ok: false, error: "'notes' must be an object" };
  }
  const notes: NotesDoc["notes"] = {};
  for (const [key, value] of Object.entries(obj.notes as Record<string, unknown>)) {
    const n = Number.parseInt(key, 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== key) {
      return { ok: false, error: `invalid slide key: ${JSON.stringify(key)}` };
    }
    if (!value || typeof value !== "object") {
      return { ok: false, error: `slide ${key} entry must be an object` };
    }
    const entry = value as { hint?: unknown; note?: unknown };
    if (entry.hint !== undefined && typeof entry.hint !== "string") {
      return { ok: false, error: `slide ${key} hint must be a string` };
    }
    if (entry.note !== undefined && typeof entry.note !== "string") {
      return { ok: false, error: `slide ${key} note must be a string` };
    }
    notes[key] = {
      hint: typeof entry.hint === "string" ? entry.hint : "",
      note: typeof entry.note === "string" ? entry.note : "",
    };
  }
  const meta =
    obj.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)
      ? (obj.meta as NotesDoc["meta"])
      : {};
  return { ok: true, doc: { meta, notes } };
}

async function loadNotesDoc(notesPath: string): Promise<NotesDoc> {
  if (!existsSync(notesPath)) {
    return {
      meta: { generator: "pdf-presenter" },
      notes: {},
    };
  }
  const raw = await readFile(notesPath, "utf8");
  try {
    const parsed = JSON.parse(raw) as Partial<NotesDoc>;
    return {
      meta: parsed.meta ?? { generator: "pdf-presenter" },
      notes: parsed.notes ?? {},
    };
  } catch {
    return {
      meta: { generator: "pdf-presenter" },
      notes: {},
    };
  }
}

async function writeNotesDoc(notesPath: string, doc: NotesDoc): Promise<void> {
  const body = JSON.stringify(doc, null, 2) + "\n";
  const tmp = `${notesPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, notesPath);
}

// Serialize writes so concurrent edits can't interleave.
function createNotesUpdater(notesPath: string) {
  let chain: Promise<unknown> = Promise.resolve();
  return (updater: (doc: NotesDoc) => NotesDoc | Promise<NotesDoc>): Promise<NotesDoc> => {
    const next = chain.then(async () => {
      const current = await loadNotesDoc(notesPath);
      const updated = await updater(current);
      await writeNotesDoc(notesPath, updated);
      return updated;
    });
    // Swallow rejection in the chain so one failure doesn't break future writes.
    chain = next.catch(() => undefined);
    return next;
  };
}

async function renderHtml(
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

export async function startServer(config: ServerConfig): Promise<StartedServer> {
  const uiDir = resolveUiDir();
  const pdfjsDir = resolvePdfjsDir();

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
