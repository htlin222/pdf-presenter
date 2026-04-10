import { createServer } from "node:net";
import { extname, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

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
