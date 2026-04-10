import { existsSync, readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { Command, Option } from "commander";
import open from "open";
import { generateNotesTemplate } from "./generate-notes.js";
import { startServer } from "./server.js";
import { findAvailablePort, notesPathFor, resolvePdfPath } from "./utils.js";

interface ServeOptions {
  port: string;
  open: boolean;
  presenter: boolean;
  notes?: string;
  timer?: string;
  generatePresenterNoteTemplate?: boolean;
  force?: boolean;
}

const VERSION = "1.0.0";

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("pdf-presenter")
    .description(
      "Serve a PDF as browser slides with a full presenter mode (notes, next preview, timer).",
    )
    .version(VERSION, "-v, --version")
    .argument("<file>", "Path to the PDF file")
    .addOption(new Option("-p, --port <port>", "Server port").default("3000"))
    .option("--no-open", "Don't auto-open browser")
    .option("--presenter", "Open directly in presenter mode", false)
    .option("-n, --notes <path>", "Path to notes JSON file")
    .option("-t, --timer <minutes>", "Countdown timer in minutes")
    .option(
      "-gn, --generate-presenter-note-template",
      "Generate a notes template JSON next to the PDF",
      false,
    )
    .option("--force", "Overwrite existing notes file when used with -gn", false)
    .action(async (file: string, options: ServeOptions) => {
      try {
        const pdfPath = resolvePdfPath(file);

        if (options.generatePresenterNoteTemplate) {
          await runGenerate(pdfPath, { force: !!options.force });
          return;
        }

        await runServe(pdfPath, options);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\nError: ${msg}\n`);
        process.exit(1);
      }
    });

  program.showHelpAfterError();
  await program.parseAsync(argv);
}

async function runGenerate(
  pdfPath: string,
  opts: { force: boolean },
): Promise<void> {
  try {
    const result = await generateNotesTemplate(pdfPath, opts);
    const rel = relative(process.cwd(), result.notesPath) || basename(result.notesPath);
    process.stdout.write(
      `\n✅ Generated ${rel} (${result.totalSlides} slides)\n\n` +
        `   Edit the "note" fields in the JSON file, then run:\n` +
        `     pdf-presenter ${relative(process.cwd(), pdfPath) || basename(pdfPath)}\n\n`,
    );
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    if (code === "NOTES_EXISTS") {
      process.stderr.write(`\n⚠ ${(err as Error).message}\n\n`);
      process.exit(1);
    }
    throw err;
  }
}

async function runServe(
  pdfPath: string,
  options: ServeOptions,
): Promise<void> {
  const startPort = Number.parseInt(options.port, 10);
  if (!Number.isFinite(startPort) || startPort <= 0) {
    throw new Error(`Invalid --port value: ${options.port}`);
  }

  const notesPath = options.notes
    ? resolveMaybeExisting(options.notes)
    : notesPathFor(pdfPath);

  let timerMinutes: number | undefined;
  if (options.timer !== undefined) {
    const t = Number.parseFloat(options.timer);
    if (!Number.isFinite(t) || t <= 0) {
      throw new Error(`Invalid --timer value: ${options.timer}`);
    }
    timerMinutes = t;
  }

  const port = await findAvailablePort(startPort);
  const server = await startServer({ pdfPath, notesPath, port, timerMinutes });

  const notesInfo = describeNotes(notesPath);
  const url = `http://localhost:${port}`;
  const presenterUrl = `${url}/presenter`;

  process.stdout.write(
    `\n🎯 pdf-presenter v${VERSION}\n\n` +
      `   Audience:   ${url}\n` +
      `   Presenter:  ${presenterUrl}\n\n` +
      `   PDF:   ${basename(pdfPath)}\n` +
      `   Notes: ${notesInfo}\n` +
      (timerMinutes !== undefined
        ? `   Timer: ${formatMinutes(timerMinutes)}\n`
        : "") +
      `\n   Press Ctrl+C to stop.\n\n`,
  );

  if (options.open) {
    const target = options.presenter ? presenterUrl : url;
    open(target).catch(() => {
      /* ignore browser open failures */
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\nReceived ${signal}, shutting down...\n`);
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

function resolveMaybeExisting(path: string): string {
  // Notes may not exist yet; that's OK. We only resolve the path.
  return path;
}

function describeNotes(notesPath: string): string {
  if (!existsSync(notesPath)) {
    return `${basename(notesPath)} (not found — using empty notes)`;
  }
  try {
    const raw = readFileSync(notesPath, "utf8");
    const parsed = JSON.parse(raw) as {
      meta?: { totalSlides?: number };
      notes?: Record<string, { note?: string }>;
    };
    const total = parsed.meta?.totalSlides ?? 0;
    const filled = Object.values(parsed.notes ?? {}).filter(
      (e) => typeof e.note === "string" && e.note.trim() !== "",
    ).length;
    const suffix = total > 0 ? ` (${filled}/${total} slides have notes)` : "";
    return `${basename(notesPath)}${suffix}`;
  } catch {
    return `${basename(notesPath)} (invalid JSON — using empty notes)`;
  }
}

function formatMinutes(minutes: number): string {
  const total = Math.round(minutes * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
