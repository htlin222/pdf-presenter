import { createServer } from "node:net";
import { extname, join, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

export function resolvePdfPath(input: string): string {
  const abs = resolve(input);
  if (!existsSync(abs)) {
    throw new Error(`File not found: ${input}`);
  }
  if (!statSync(abs).isFile()) {
    throw new Error(`Not a file: ${input}`);
  }
  if (extname(abs).toLowerCase() !== ".pdf") {
    throw new Error(`Not a PDF file: ${input}`);
  }
  return abs;
}

export function notesPathFor(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, ".notes.json");
}

export function resolveDirectoryPath(input: string): string {
  const abs = resolve(input);
  if (!existsSync(abs)) {
    throw new Error(`Path not found: ${input}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${input}`);
  }
  return abs;
}

export function listPdfsInDirectory(dirPath: string): string[] {
  return readdirSync(dirPath)
    .filter((f) => extname(f).toLowerCase() === ".pdf")
    .sort((a, b) => a.localeCompare(b));
}

export interface PdfNotesStatus {
  pdfName: string;
  hasNotes: boolean;
  filledCount: number;
  totalSlides: number;
}

export function getPdfNotesStatus(
  dirPath: string,
  pdfName: string,
): PdfNotesStatus {
  const notesPath = notesPathFor(join(dirPath, pdfName));
  const result: PdfNotesStatus = {
    pdfName,
    hasNotes: false,
    filledCount: 0,
    totalSlides: 0,
  };
  if (!existsSync(notesPath)) return result;
  try {
    const raw = JSON.parse(readFileSync(notesPath, "utf8"));
    result.hasNotes = true;
    result.totalSlides = raw.meta?.totalSlides ?? 0;
    const notes: Record<string, { note?: string }> = raw.notes ?? {};
    result.filledCount = Object.values(notes).filter(
      (n) => typeof n.note === "string" && n.note.trim().length > 0,
    ).length;
  } catch {
    // malformed notes file — treat as exists but empty
    result.hasNotes = true;
  }
  return result;
}

export async function findAvailablePort(
  startPort: number,
  maxAttempts = 10,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `Could not find a free port (tried ${startPort}..${startPort + maxAttempts - 1})`,
  );
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolveP) => {
    const srv = createServer();
    srv.once("error", () => resolveP(false));
    srv.once("listening", () => {
      srv.close(() => resolveP(true));
    });
    srv.listen(port, "127.0.0.1");
  });
}
