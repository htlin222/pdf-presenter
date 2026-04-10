# pdf-presenter — Project Plan

## Overview

A lightweight, zero-config CLI tool that serves PDF slides in the browser with a full presenter mode (speaker notes, next slide preview, timer). No markdown conversion, no native dependencies — just point it at a PDF and go.

```bash
npx pdf-presenter slides.pdf          # serve & open browser
npx pdf-presenter -gn slides.pdf      # generate notes template
```

---

## 1. Package Identity

- **Name:** `pdf-presenter` (check npm availability, fallback: `pdf-slide-presenter`)
- **License:** MIT
- **Node:** >=18
- **Binary name:** `pdf-presenter`

---

## 2. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript (strict) | Shared with frontend, single ecosystem |
| CLI framework | `commander` | Lightweight, standard |
| PDF rendering | `pdfjs-dist` (Mozilla pdf.js) | The only real option for browser PDF rendering |
| Dev server | Node built-in `http` + `fs` | Zero dependency, no express needed |
| Port finding | `get-port` or manual fallback scan | Avoid conflicts |
| Browser open | `open` (npm package) | Cross-platform open-in-browser |
| Build | `tsup` | Fast, simple TS → JS bundler for CLI |
| Presenter sync | `BroadcastChannel` API | Sync slide state between audience & presenter windows, no WebSocket needed |

---

## 3. Project Structure

```
pdf-presenter/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
├── LICENSE
├── bin/
│   └── pdf-presenter.ts          # CLI entry point (commander setup)
├── src/
│   ├── cli.ts                    # CLI logic: arg parsing, command dispatch
│   ├── server.ts                 # HTTP server: serves PDF, notes, and UI
│   ├── generate-notes.ts         # --generate-presenter-note-template logic
│   ├── utils.ts                  # helpers: find free port, resolve paths, etc.
│   └── ui/                       # Static frontend assets (served as-is)
│       ├── audience.html         # Audience view (fullscreen slides)
│       ├── presenter.html        # Presenter view (current + next + notes + timer)
│       ├── presenter.css         # Presenter UI styling
│       └── presenter.js          # Shared JS: pdf.js rendering, BroadcastChannel sync, keyboard nav
└── test/
    ├── fixtures/
    │   ├── sample.pdf
    │   └── sample.notes.json
    ├── generate-notes.test.ts
    └── server.test.ts
```

---

## 4. CLI Interface

### 4.1 Default command: serve

```bash
pdf-presenter <file.pdf> [options]
```

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--port` | `-p` | `3000` (auto-increment if taken) | Server port |
| `--no-open` | | `false` | Don't auto-open browser |
| `--presenter` | | `false` | Open directly in presenter mode |
| `--notes` | `-n` | `<file>.notes.json` | Path to notes JSON file |
| `--timer` | `-t` | none | Countdown timer in minutes (e.g. `-t 20`) |

**Behavior:**

1. Resolve absolute path to the PDF file. Validate it exists and is a `.pdf`.
2. Look for `<filename>.notes.json` in the same directory (or use `--notes` path).
3. Find an available port (starting from `--port`).
4. Start HTTP server serving:
   - `/` → audience.html
   - `/presenter` → presenter.html
   - `/slides.pdf` → the actual PDF file (streamed)
   - `/notes.json` → the notes file (or empty `{"notes":{}}` if none exists)
   - `/assets/*` → static JS/CSS
5. Open browser to `http://localhost:<port>` (or `/presenter` if `--presenter` flag).
6. Print to terminal:
   ```
   🎯 pdf-presenter v1.0.0

   Audience:   http://localhost:3000
   Presenter:  http://localhost:3000/presenter

   PDF:   slides.pdf (24 slides)
   Notes: slides.notes.json (18/24 slides have notes)
   Timer: 20:00

   Press Ctrl+C to stop.
   ```

### 4.2 Generate notes template

```bash
pdf-presenter --generate-presenter-note-template <file.pdf>
pdf-presenter -gn <file.pdf>
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--generate-presenter-note-template` | `-gn` | Generate a notes template JSON in the same directory as the PDF |

**Behavior:**

1. Read the PDF using `pdfjs-dist` in Node.js (not browser).
2. Extract total page count.
3. For each page, extract the **first line of text** (or first N characters) as a slide label/hint — this helps the user know which slide they're writing notes for without opening the PDF side-by-side.
4. Generate `<filename>.notes.json` in the **same directory as the PDF**.
5. If the file already exists, **abort with a warning** and suggest `--force` to overwrite.
6. Print summary to terminal.

**Generated file format** (`slides.notes.json`):

```json
{
  "meta": {
    "pdf": "slides.pdf",
    "totalSlides": 24,
    "generatedAt": "2026-04-10T12:00:00.000Z",
    "generator": "pdf-presenter"
  },
  "notes": {
    "1": {
      "hint": "Introduction — Welcome to Our Q3 Review",
      "note": ""
    },
    "2": {
      "hint": "Agenda — Topics for Today",
      "note": ""
    },
    "3": {
      "hint": "Revenue Overview — Q3 2025 Financial Summary",
      "note": ""
    }
  }
}
```

- `hint` is auto-extracted, read-only context for the user. The presenter UI can optionally show it.
- `note` is what the user fills in. This is what gets displayed in presenter mode.
- Slide keys are 1-indexed strings.

**Why JSON over markdown?** Parsing is trivial (just `JSON.parse`), no ambiguity about slide boundaries, easy to validate, and the frontend reads it directly without any conversion step.

### 4.3 Additional flags

| Flag | Description |
|------|-------------|
| `--version` | Print version |
| `--help` | Print help |
| `--force` | Used with `-gn` to overwrite existing notes file |

---

## 5. Frontend UI

### 5.1 Audience View (`audience.html`)

- Fullscreen, clean, black background.
- Renders current PDF page via `pdfjs-dist` onto a `<canvas>`, scaled to fit viewport.
- Navigation: arrow keys, page up/down, click, touch swipe.
- Listens to `BroadcastChannel("pdf-presenter")` for slide change events from presenter.
- No chrome, no controls — just the slide.
- Press `P` to open presenter mode in a new window.

### 5.2 Presenter View (`presenter.html`)

Layout (single page, no scroll):

```
┌─────────────────────────────┬──────────────────┐
│                             │                  │
│     Current Slide           │   Next Slide     │
│     (large, ~60% width)     │   (smaller)      │
│                             │                  │
├─────────────────────────────┴──────────────────┤
│                                                │
│  Speaker Notes                    Timer  00:00  │
│  (scrollable if long)         Slide 3 / 24     │
│                                                │
└────────────────────────────────────────────────┘
```

- Both slide canvases rendered via pdf.js.
- Notes area shows `notes[currentSlide].note`. If empty, show the `hint` in a muted style as fallback.
- Timer: counts up by default, or counts down if `--timer` was set (passed via a meta tag or inline script variable).
- Timer color: green → yellow (last 5 min) → red (last 1 min) for countdown mode.
- Slide counter: `3 / 24`.
- Keyboard navigation same as audience view, but also broadcasts changes via `BroadcastChannel`.
- `F` key: freeze/unfreeze audience view.
- `B` key: black out audience view.
- `R` key: reset timer.

### 5.3 Sync Mechanism

- `BroadcastChannel("pdf-presenter")` — works across tabs/windows in same browser, no server needed.
- Message format: `{ type: "slide", slide: 3 }`, `{ type: "freeze" }`, `{ type: "black" }`.
- The presenter window is the **controller**. Audience windows are **listeners**.
- Multiple audience windows are supported (e.g., one shared via screen share, one on a second monitor).

### 5.4 pdf.js Integration

- Use `pdfjs-dist` npm package.
- Set the worker source to the bundled worker from `pdfjs-dist/build/pdf.worker.min.mjs` — the server must serve this file too.
- Render workflow: `pdfjsLib.getDocument(url)` → `pdf.getPage(n)` → `page.render({ canvasContext, viewport })`.
- Pre-render adjacent slides (current ± 1) for smooth transitions.
- Handle high-DPI: set canvas dimensions to `viewport * devicePixelRatio`, then CSS scale down.

---

## 6. Server Implementation (`src/server.ts`)

Simple `http.createServer` with a route map:

| Route | Serves | Content-Type |
|-------|--------|-------------|
| `/` | `audience.html` | `text/html` |
| `/presenter` | `presenter.html` | `text/html` |
| `/slides.pdf` | The user's PDF file (streamed via `fs.createReadStream`) | `application/pdf` |
| `/notes.json` | The notes file (or empty stub) | `application/json` |
| `/assets/presenter.js` | Frontend JS | `application/javascript` |
| `/assets/presenter.css` | Presenter CSS | `text/css` |
| `/assets/pdf.worker.min.mjs` | pdf.js web worker | `application/javascript` |
| `/assets/pdfjs-dist/*` | pdf.js library files | appropriate MIME |

- No framework, no middleware. A simple `switch` or map on `req.url`.
- CORS not needed (same origin).
- The UI HTML files can be inlined as template strings in the build, or served from the package's dist directory.
- Graceful shutdown on `SIGINT` / `SIGTERM`.

---

## 7. Build & Packaging

### tsup.config.ts

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["bin/pdf-presenter.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: false,
  // Bundle everything except pdfjs-dist (keep as external, it ships its own worker)
  external: ["pdfjs-dist"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
```

### package.json key fields

```json
{
  "name": "pdf-presenter",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "pdf-presenter": "./dist/pdf-presenter.js"
  },
  "files": [
    "dist/",
    "src/ui/"
  ],
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "commander": "^12.x",
    "get-port": "^7.x",
    "open": "^10.x",
    "pdfjs-dist": "^4.x"
  },
  "devDependencies": {
    "tsup": "^8.x",
    "typescript": "^5.x",
    "vitest": "^2.x"
  }
}
```

---

## 8. Generate Notes Template — Detailed Logic

```
src/generate-notes.ts
```

```
function generateNotesTemplate(pdfPath: string, options: { force: boolean })
```

1. **Resolve paths:**
   - `pdfPath` → absolute path.
   - `notesPath` → same directory, same basename, extension `.notes.json`.

2. **Check existing file:**
   - If `notesPath` exists and `!options.force`, print warning and exit:
     ```
     ⚠ slides.notes.json already exists.
       Use --force to overwrite.
     ```

3. **Load PDF in Node.js:**
   - Use `pdfjs-dist` Node.js build (no canvas needed for text extraction).
   - `const pdf = await pdfjsLib.getDocument(readFileSync(pdfPath)).promise;`

4. **Extract hints per page:**
   - For each page 1..N:
     - `const page = await pdf.getPage(i);`
     - `const textContent = await page.getTextContent();`
     - Concatenate `textContent.items[].str`, take first 80 characters, trim.
     - This becomes the `hint` field.

5. **Build JSON structure** (see format in §4.2).

6. **Write file** with `JSON.stringify(data, null, 2)` + trailing newline.

7. **Print summary:**
   ```
   ✅ Generated slides.notes.json (24 slides)

   Edit the "note" fields in the JSON file, then run:
     pdf-presenter slides.pdf
   ```

---

## 9. Edge Cases & Error Handling

| Case | Behavior |
|------|----------|
| PDF not found | `Error: File not found: slides.pdf` |
| File is not a PDF | `Error: Not a PDF file: report.docx` |
| Notes file missing | Serve empty notes, presenter shows "No notes for this slide" in muted text |
| Notes file has fewer entries than slides | Missing slides show no notes, no crash |
| Notes file has extra entries | Ignored silently |
| Port taken | Auto-increment, try next port (up to 10 attempts) |
| pdf.js worker fails to load | Show error in browser console with clear message |
| Ctrl+C | Graceful shutdown, clean exit |
| PDF with 0 pages | `Error: PDF has no pages` |
| Very large PDF (500+ pages) | Works, but warn: "Large PDF (523 pages), rendering may be slow" |

---

## 10. Future Enhancements (Out of Scope for v1, but design for)

- `--theme dark|light` — presenter UI theme
- `--export` — export to self-contained HTML (like pdf-webslides `-s`)
- `--remote` — WebSocket sync for presenting over LAN (not just same browser)
- `--markdown-notes` — support `slides.notes.md` as alternative to JSON, with `---` slide separators
- Live reload of notes file (watch `notes.json` for changes, push to presenter)
- Slide annotations / laser pointer overlay
- Integration with OBS / streaming tools

---

## 11. Implementation Order

1. **Scaffold project** — `package.json`, `tsconfig.json`, `tsup.config.ts`, directory structure
2. **`-gn` command** — implement `generate-notes.ts` first, since it's self-contained and lets you test pdf.js in Node immediately
3. **Server** — `src/server.ts` with static file serving, route map
4. **Audience view** — `audience.html` + pdf.js rendering + keyboard nav
5. **Presenter view** — `presenter.html` with layout, notes display, timer
6. **BroadcastChannel sync** — wire up presenter → audience communication
7. **CLI glue** — `commander` setup, port finding, browser open
8. **Polish** — error handling, terminal output formatting, edge cases
9. **Test** — vitest for generate-notes and server logic
10. **README + publish** — npm publish, usage docs

---

## 12. User Workflow (Final UX)

```bash
# Step 1: Generate notes template
npx pdf-presenter -gn slides.pdf
# → creates slides.notes.json with hints for each slide

# Step 2: Edit notes
# Open slides.notes.json in any editor, fill in "note" fields

# Step 3: Present
npx pdf-presenter slides.pdf
# → starts server, opens browser
# → share the audience tab/window
# → keep presenter tab for yourself

# Step 4: Present with countdown
npx pdf-presenter slides.pdf --timer 20
```

That's it. PDF in, presenter mode out.
