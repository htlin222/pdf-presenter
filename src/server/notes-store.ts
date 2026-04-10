import { existsSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import type { NotesDoc } from "./types.js";

export function validateNotesDoc(
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

export async function loadNotesDoc(notesPath: string): Promise<NotesDoc> {
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

export async function writeNotesDoc(notesPath: string, doc: NotesDoc): Promise<void> {
  const body = JSON.stringify(doc, null, 2) + "\n";
  const tmp = `${notesPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, notesPath);
}

/**
 * Serialize writes so concurrent edits can't interleave. Each call waits
 * for any in-flight update to finish before loading, mutating, and writing
 * the file. A failed update doesn't block subsequent updates.
 */
export function createNotesUpdater(notesPath: string) {
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
