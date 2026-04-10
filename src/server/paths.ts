import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the `src/ui` directory relative to the caller's module file.
 * Callers should pass `import.meta.url` from their own module (typically
 * `src/server.ts`) so the candidate paths remain anchored at the top-level
 * entry point regardless of how deeply `paths.ts` itself is nested.
 *
 * Candidate layouts:
 *   dist/pdf-presenter.js → ../src/ui (published bundle)
 *   src/server.ts          → ./ui     (dev via tsx)
 */
export function resolveUiDir(callerUrl: string): string {
  const here = dirname(fileURLToPath(callerUrl));
  const candidates = [
    resolve(here, "../src/ui"), // published layout: dist/ → ../src/ui
    resolve(here, "./ui"), // dev: src/ → ./ui
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Could not locate UI assets (looked in: ${candidates.join(", ")})`,
  );
}

export function resolvePdfjsDir(callerUrl: string): string {
  const require = createRequire(callerUrl);
  const pkgJson = require.resolve("pdfjs-dist/package.json");
  return dirname(pkgJson);
}
