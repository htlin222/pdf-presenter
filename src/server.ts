import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig, StartedServer } from "./server/types.js";
import { send, notFound } from "./server/http-utils.js";
import { resolveUiDir, resolvePdfjsDir } from "./server/paths.js";
import { renderHtml } from "./server/html-render.js";
import { createNotesUpdater } from "./server/notes-store.js";
import { handleNotesRoutes } from "./server/routes/notes.js";
import { handleRecordingRoutes } from "./server/routes/recording.js";
import { handleStaticRoutes } from "./server/routes/static.js";

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
    try {
      // Ordering: recording (most specific prefixes) → notes → static catch-all.
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

      if (
        (await handleStaticRoutes(req, res, url, {
          audienceHtml,
          presenterHtml,
          pdfPath: config.pdfPath,
          notesPath: config.notesPath,
          uiDir,
          pdfjsDir,
        })) === "handled"
      )
        return;

      notFound(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) send(res, 500, `Internal Server Error: ${msg}`);
      else res.end();
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
