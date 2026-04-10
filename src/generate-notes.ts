import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, relative } from "node:path";
import { notesPathFor } from "./utils.js";

export interface NotesFile {
  meta: {
    pdf: string;
    totalSlides: number;
    generatedAt: string;
    generator: string;
  };
  notes: Record<string, { hint: string; note: string }>;
}

export interface GenerateOptions {
  force: boolean;
}

export interface GenerateResult {
  notesPath: string;
  totalSlides: number;
}

const HINT_MAX = 80;

export async function generateNotesTemplate(
  pdfPath: string,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const notesPath = notesPathFor(pdfPath);

  if (existsSync(notesPath) && !options.force) {
    const rel = relative(process.cwd(), notesPath) || basename(notesPath);
    const err = new Error(
      `${rel} already exists. Use --force to overwrite.`,
    );
    (err as Error & { code?: string }).code = "NOTES_EXISTS";
    throw err;
  }

  // Use pdfjs-dist legacy build — it works in Node without DOM/canvas
  // and is the recommended entry point for server-side usage.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(await readFile(pdfPath));
  const pdf = await pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const totalSlides = pdf.numPages;
  if (totalSlides === 0) {
    throw new Error("PDF has no pages");
  }

  const notes: NotesFile["notes"] = {};
  for (let i = 1; i <= totalSlides; i++) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();
    const joined = text.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const hint = joined.slice(0, HINT_MAX).trim();
    notes[String(i)] = { hint, note: "" };
  }

  await pdf.cleanup();
  await pdf.destroy();

  const out: NotesFile = {
    meta: {
      pdf: basename(pdfPath),
      totalSlides,
      generatedAt: new Date().toISOString(),
      generator: "pdf-presenter",
    },
    notes,
  };

  await writeFile(notesPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  return { notesPath, totalSlides };
}
