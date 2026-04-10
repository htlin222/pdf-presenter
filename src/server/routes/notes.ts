import type { IncomingMessage, ServerResponse } from "node:http";
import type { NotesDoc, RouteResult } from "../types.js";
import { MIME, send, readJsonBody } from "../http-utils.js";
import { validateNotesDoc, createNotesUpdater } from "../notes-store.js";

export interface NotesRouteDeps {
  notesPath: string;
  updateNotes: ReturnType<typeof createNotesUpdater>;
}

/**
 * Handles mutation endpoints for the notes file:
 *   - PUT|POST /api/notes       → single-slide update
 *   - PUT|POST /api/notes-file  → full-file replace (validated)
 *
 * GET /notes.json lives in routes/static.ts because it's a plain file
 * stream, not a mutation.
 */
export async function handleNotesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: NotesRouteDeps,
): Promise<RouteResult> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  const { updateNotes } = deps;

  if (pathname === "/api/notes-file" && (method === "PUT" || method === "POST")) {
    const body = (await readJsonBody(req)) as Partial<NotesDoc>;
    const validation = validateNotesDoc(body);
    if (!validation.ok) {
      send(res, 400, JSON.stringify({ error: validation.error }), MIME[".json"]);
      return "handled";
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
    return "handled";
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
      return "handled";
    }
    if (typeof note !== "string") {
      send(
        res,
        400,
        JSON.stringify({ error: "note must be a string" }),
        MIME[".json"],
      );
      return "handled";
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
    send(res, 200, JSON.stringify({ ok: true, slide: slideNum }), MIME[".json"]);
    return "handled";
  }

  return "pass";
}
