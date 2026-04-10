# pdf-presenter

<p align="center">
  <a href="https://www.npmjs.com/package/pdf-presenter"><img alt="npm version" src="https://img.shields.io/npm/v/pdf-presenter?color=cb3837&logo=npm&logoColor=white&label=npm"></a>
  <a href="https://www.npmjs.com/package/pdf-presenter"><img alt="npm downloads" src="https://img.shields.io/npm/dm/pdf-presenter?color=cb3837&logo=npm&logoColor=white"></a>
  <a href="https://github.com/htlin222/pdf-presenter/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/pdf-presenter?color=blue"></a>
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/node/v/pdf-presenter?color=5fa04e&logo=node.js&logoColor=white"></a>
</p>

<p align="center">
  <a href="https://github.com/htlin222/pdf-presenter/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/htlin222/pdf-presenter/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/htlin222/pdf-presenter/actions/workflows/publish.yml"><img alt="Publish" src="https://github.com/htlin222/pdf-presenter/actions/workflows/publish.yml/badge.svg"></a>
  <a href="https://github.com/htlin222/pdf-presenter/releases"><img alt="release" src="https://img.shields.io/github/v/release/htlin222/pdf-presenter?color=6f42c1&logo=github&logoColor=white"></a>
  <a href="https://www.npmjs.com/package/pdf-presenter"><img alt="provenance" src="https://img.shields.io/badge/npm-provenance%20verified-2ea44f?logo=npm&logoColor=white"></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-f69220?logo=pnpm&logoColor=white">
  <img alt="tsup" src="https://img.shields.io/badge/bundler-tsup-ff4f64">
  <img alt="pdf.js" src="https://img.shields.io/badge/pdf.js-4.x-e31e24">
  <a href="https://github.com/htlin222/pdf-presenter/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/htlin222/pdf-presenter?style=social"></a>
</p>

> Lightweight CLI that serves a PDF as browser slides with a full presenter mode — speaker notes, next-slide preview, pause-able timer, audio recording with per-slide timeline metadata, and resizable panes. No markdown conversion, no native dependencies. Point it at a PDF and go.

[繁體中文版 →](./README-zhtw.md)

```bash
npx pdf-presenter slides.pdf           # serve & open browser
npx pdf-presenter -gn slides.pdf       # generate a notes template
npx pdf-presenter slides.pdf -t 20     # 20-minute countdown
```

---

## Why

Presenting a PDF deck usually means either:

- Opening the PDF in a viewer and losing speaker notes / next-slide preview, or
- Converting slides to HTML (and fighting layout, fonts, and build tooling).

`pdf-presenter` takes a third path: keep the PDF as-is, render it with `pdf.js` in the browser, and layer a presenter window (current + next + notes + timer) on top. Slide state syncs between the audience and presenter windows via `BroadcastChannel` — no WebSocket, no server round-trip.

## Features

- **Zero config.** One argument: the PDF file.
- **Dual views.** Audience view (fullscreen slide) and presenter view (current, next, notes, timer, counter).
- **Speaker notes** from a simple JSON file. Generate a template from the PDF text with `-gn`, or **edit notes directly in the presenter view** — changes are saved back to `slides.notes.json` automatically (debounced).
- **Timer.** Count up by default, or count down with `--timer <minutes>`. Colour shifts yellow in the last 5 min, red in the last 1 min.
- **Keyboard-first.** Arrow keys, `Space`, `PageUp/Down`, `Home/End`, plus `F` freeze, `B` black, `R` reset timer.
- **Multi-window sync** via `BroadcastChannel` — the presenter window drives one or more audience windows in the same browser.
- **No native deps.** Pure JavaScript. `pdf.js` does the heavy lifting.

## Install

Run without installing:

```bash
npx pdf-presenter slides.pdf
```

Or install globally:

```bash
npm i -g pdf-presenter
pdf-presenter slides.pdf
```

Requires Node.js ≥ 18.

## Usage

### Serve a PDF

```bash
pdf-presenter <file.pdf> [options]
```

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--port <n>` | `-p` | `3000` (auto-increments if taken) | Server port |
| `--no-open` | | | Don't auto-open the browser |
| `--presenter` | | `false` | Open directly in presenter mode |
| `--notes <path>` | `-n` | `<file>.notes.json` | Path to notes JSON |
| `--timer <minutes>` | `-t` | none | Countdown timer in minutes |
| `--version` | `-v` | | Print version |
| `--help` | `-h` | | Print help |

On start you'll see:

```
🎯 pdf-presenter v1.0.0

   Audience:   http://localhost:3000
   Presenter:  http://localhost:3000/presenter

   PDF:   slides.pdf
   Notes: slides.notes.json (18/24 slides have notes)
   Timer: 20:00

   Press Ctrl+C to stop.
```

Share the **audience** URL (or window) with your viewers. Keep the **presenter** URL for yourself.

### Generate a notes template

```bash
pdf-presenter -gn slides.pdf
pdf-presenter --generate-presenter-note-template slides.pdf
pdf-presenter -gn slides.pdf --force    # overwrite existing
```

This reads the PDF, extracts the first line of text from each page as a `hint`, and writes `slides.notes.json` next to the PDF:

```json
{
  "meta": {
    "pdf": "slides.pdf",
    "totalSlides": 24,
    "generatedAt": "2026-04-10T12:00:00.000Z",
    "generator": "pdf-presenter"
  },
  "notes": {
    "1": { "hint": "Introduction — Welcome", "note": "" },
    "2": { "hint": "Agenda — Topics for Today", "note": "" }
  }
}
```

- `hint` is auto-extracted and shown in the presenter view when a slide has no `note`.
- `note` is what you write. It appears as the speaker notes in the presenter view.
- Keys are 1-indexed slide numbers.

If `slides.notes.json` already exists, `-gn` aborts with a warning — use `--force` to overwrite.

### Editing notes live

The presenter view doubles as an editor: click into the notes panel and type. Changes are saved back to `slides.notes.json` automatically (debounced ~600 ms after you stop typing). A small status indicator shows `Saving…` / `Saved` / `Save failed` next to the panel title.

- While the notes textarea is focused, keyboard shortcuts (arrow keys, `F`, `B`, `R`) are disabled so typing isn't hijacked. Press **`Esc`** to blur the editor and return to slide navigation.
- If `slides.notes.json` doesn't exist yet, the first save creates it.
- Existing `hint` fields are preserved. The panel title shows the hint for the current slide in a muted style.
- Writes are serialized server-side, so edits from multiple windows can't clobber each other mid-write.

## Keyboard shortcuts

Both views:

| Key | Action |
|-----|--------|
| `→` / `Space` / `PageDown` | Next slide |
| `←` / `PageUp` | Previous slide |
| `Home` / `End` | First / last slide (presenter) |

Audience view only:

| Key | Action |
|-----|--------|
| `P` | Open presenter view in a new window |

Presenter view only:

| Key | Action |
|-----|--------|
| `F` | Freeze / unfreeze the audience view |
| `B` | Black out the audience view |
| `R` | Reset the timer |

## Typical workflow

```bash
# 1. Generate the notes template
pdf-presenter -gn slides.pdf

# 2. Edit slides.notes.json in your editor, fill in "note" fields

# 3. Present
pdf-presenter slides.pdf --timer 20
```

Then:

1. The audience URL opens in your browser — share that window (or drag it to your projector / second display).
2. Open the presenter URL in a second window on your laptop screen.
3. Drive the deck from the presenter window. The audience window follows automatically.

## How it works

- `pdfjs-dist` (Mozilla `pdf.js`) renders each page to a `<canvas>` in the browser, scaled to fit the viewport at device-pixel-ratio resolution.
- The Node CLI ships a minimal `http` server (no Express, no middleware) that serves:
  - `/` → audience HTML
  - `/presenter` → presenter HTML
  - `/slides.pdf` → your PDF, streamed from disk
  - `/notes.json` → the notes file (or an empty stub if missing)
  - `/assets/*` → UI JS/CSS
  - `/assets/pdfjs/*` → the `pdfjs-dist` library and worker
- The presenter window broadcasts slide changes via `BroadcastChannel("pdf-presenter")`. Audience windows in the same browser listen and re-render.
- Notes text extraction for `-gn` uses the legacy `pdfjs-dist` build, which runs in Node without a DOM or canvas.

## Development

```bash
make install    # pnpm install
make build      # tsup build → dist/
make check      # tsc --noEmit
make run        # build + run against test/fixtures/sample.pdf
make clean      # remove dist/ and node_modules/
```

Project layout:

```
pdf-presenter/
├── bin/pdf-presenter.ts       # CLI entry point
├── src/
│   ├── cli.ts                 # commander setup, command dispatch
│   ├── server.ts              # HTTP server + route map
│   ├── generate-notes.ts      # -gn command
│   ├── utils.ts               # path/port helpers
│   └── ui/                    # static frontend
│       ├── audience.html
│       ├── presenter.html
│       ├── presenter.css
│       └── presenter.js       # pdf.js rendering + BroadcastChannel sync
└── test/fixtures/             # sample PDF for smoke tests
```

## License

MIT
