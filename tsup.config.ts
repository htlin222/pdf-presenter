import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "pdf-presenter": "bin/pdf-presenter.ts" },
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: false,
  sourcemap: false,
  shims: false,
  external: ["pdfjs-dist"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
