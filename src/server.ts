import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerConfig, StartedServer } from "./server/types.js";
import {
  MIME,
  EMPTY_NOTES,
  send,
  notFound,
  streamFile,
  contentTypeFor,
} from "./server/http-utils.js";
import { resolveUiDir, resolvePdfjsDir } from "./server/paths.js";
import { renderHtml } from "./server/html-render.js";
import { createNotesUpdater } from "./server/notes-store.js";
import { handleNotesRoutes } from "./server/routes/notes.js";
import { handleRecordingRoutes } from "./server/routes/recording.js";

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

    try {
      if (
        (await handleRecordingRoutes(req, res, url, {
          pdfPath: config.pdfPath,
        })) === "handled"
      )
        return;

      if (
        (await handleNotesRoutes(req, res, url, {
          notesPath: config.notesPath,
          updateNotes,
        })) === "handled"
      )
        return;

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
