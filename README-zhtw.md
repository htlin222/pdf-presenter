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

> 輕量級 CLI 工具，用瀏覽器播放 PDF 投影片，並提供完整的主講者模式 —— 包含講者備註、下一張預覽、可暫停的計時器、帶有逐張時間軸的錄音，以及可調整的面板。不需要轉換 Markdown，也不需要原生相依套件。指向 PDF，就能開始。

[English version →](./README.md)

```bash
npx pdf-presenter slides.pdf           # 啟動伺服器並開啟瀏覽器
npx pdf-presenter -gn slides.pdf       # 產生備註樣板
npx pdf-presenter slides.pdf -t 20     # 20 分鐘倒數計時
```

---

## 為什麼要有這個工具

用 PDF 進行簡報通常只有兩條路：

- 用 PDF 檢視器開啟，但就失去講者備註和下一張預覽，或
- 把投影片轉成 HTML（然後跟版面、字型、建構工具纏鬥）。

`pdf-presenter` 走第三條路：保留 PDF 原狀，用瀏覽器裡的 `pdf.js` 渲染，並在上面疊一個主講者視窗（目前 + 下一張 + 備註 + 計時器）。投影片狀態透過 `BroadcastChannel` 在觀眾與主講者視窗之間同步 —— 不用 WebSocket，不用跟伺服器來回通訊。

## 功能特色

- **零設定。** 只要一個參數：PDF 檔案。
- **雙視圖。** 觀眾視圖（全螢幕投影片）與主講者視圖（目前、下一張、備註、計時器、頁碼）。
- **講者備註** 使用簡單的 JSON 檔。可用 `-gn` 從 PDF 文字產生樣板，或**直接在主講者視圖中編輯備註** —— 變更會自動寫回 `slides.notes.json`（防抖動延遲儲存）。
- **計時器。** 預設為計時，或用 `--timer <分鐘>` 倒數計時。最後 5 分鐘轉黃、最後 1 分鐘轉紅。
- **鍵盤優先。** 方向鍵、`Space`、`PageUp/Down`、`Home/End`，加上 `F` 凍結、`B` 黑畫面、`R` 重置計時器。
- **多視窗同步** 透過 `BroadcastChannel` —— 主講者視窗驅動同一瀏覽器內的一個或多個觀眾視窗。
- **無原生相依。** 純 JavaScript。由 `pdf.js` 處理重活。

## 安裝

不安裝直接執行：

```bash
npx pdf-presenter slides.pdf
```

或全域安裝：

```bash
npm i -g pdf-presenter
pdf-presenter slides.pdf
```

需要 Node.js ≥ 18。

## 用法

### 播放 PDF

```bash
pdf-presenter <file.pdf> [選項]
```

| 旗標 | 簡寫 | 預設值 | 說明 |
|------|------|--------|------|
| `--port <n>` | `-p` | `3000`（若被佔用會自動遞增） | 伺服器連接埠 |
| `--no-open` | | | 不要自動開啟瀏覽器 |
| `--presenter` | | `false` | 直接以主講者模式開啟 |
| `--notes <path>` | `-n` | `<file>.notes.json` | 備註 JSON 檔路徑 |
| `--timer <minutes>` | `-t` | 無 | 倒數計時分鐘數 |
| `--version` | `-v` | | 印出版本 |
| `--help` | `-h` | | 印出說明 |

啟動後會看到：

```
🎯 pdf-presenter v1.0.0

   Audience:   http://localhost:3000
   Presenter:  http://localhost:3000/presenter

   PDF:   slides.pdf
   Notes: slides.notes.json (18/24 slides have notes)
   Timer: 20:00

   Press Ctrl+C to stop.
```

把 **Audience** URL（或視窗）分享給觀眾，**Presenter** URL 留給自己。

### 產生備註樣板

```bash
pdf-presenter -gn slides.pdf
pdf-presenter --generate-presenter-note-template slides.pdf
pdf-presenter -gn slides.pdf --force    # 覆蓋既有檔案
```

這會讀取 PDF、擷取每頁的第一行文字做為 `hint`（提示），並在 PDF 旁邊寫入 `slides.notes.json`：

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

- `hint` 是自動擷取的，當該張投影片沒有 `note` 時會顯示在主講者視圖。
- `note` 是你要寫的內容，會在主講者視圖中作為講者備註顯示。
- 鍵值是從 1 開始的投影片編號。

若 `slides.notes.json` 已存在，`-gn` 會出警告並中止 —— 用 `--force` 強制覆蓋。

### 即時編輯備註

主講者視圖本身就是編輯器：點進備註區域開始打字。變更會自動寫回 `slides.notes.json`（停止打字約 600 毫秒後觸發防抖動儲存）。面板標題旁的小指示器會顯示 `Saving…` / `Saved` / `Save failed`。

- 當備註區塊取得焦點時，鍵盤快捷鍵（方向鍵、`F`、`B`、`R`）會暫時停用，避免打字被吃掉。按 **`Esc`** 可離開編輯器並回到投影片導覽模式。
- 若 `slides.notes.json` 尚未存在，首次儲存會自動建立。
- 既有的 `hint` 欄位會被保留。面板標題會以淡色顯示當前投影片的 hint。
- 伺服器端的寫入是序列化的，所以從多個視窗同時編輯也不會互相蓋掉。

## 鍵盤快捷鍵

兩種視圖共用：

| 按鍵 | 動作 |
|------|------|
| `→` / `Space` / `PageDown` | 下一張投影片 |
| `←` / `PageUp` | 上一張投影片 |
| `Home` / `End` | 第一張 / 最後一張（主講者） |

只在觀眾視圖：

| 按鍵 | 動作 |
|------|------|
| `P` | 在新視窗開啟主講者視圖 |

只在主講者視圖：

| 按鍵 | 動作 |
|------|------|
| `F` | 凍結 / 解除凍結觀眾視圖 |
| `B` | 觀眾視圖黑畫面 |
| `R` | 重置計時器 |

## 典型流程

```bash
# 1. 產生備註樣板
pdf-presenter -gn slides.pdf

# 2. 在編輯器裡開啟 slides.notes.json，填入 "note" 欄位

# 3. 開始簡報
pdf-presenter slides.pdf --timer 20
```

接著：

1. 觀眾 URL 會在瀏覽器打開 —— 把那個視窗分享出去（或拖到投影機 / 第二螢幕）。
2. 在筆電螢幕上用第二個視窗開啟主講者 URL。
3. 從主講者視窗控制投影片，觀眾視窗會自動跟隨。

## 運作原理

- `pdfjs-dist`（Mozilla `pdf.js`）把每頁渲染到瀏覽器的 `<canvas>`，以 device-pixel-ratio 解析度縮放以符合視窗大小。
- Node CLI 內建一個極簡的 `http` 伺服器（沒有 Express、沒有 middleware），提供以下路由：
  - `/` → 觀眾 HTML
  - `/presenter` → 主講者 HTML
  - `/slides.pdf` → 你的 PDF，從磁碟以串流方式回傳
  - `/notes.json` → 備註檔（若不存在則回傳空白樣板）
  - `/assets/*` → 前端 JS/CSS
  - `/assets/pdfjs/*` → `pdfjs-dist` 函式庫和 worker
- 主講者視窗透過 `BroadcastChannel("pdf-presenter")` 廣播投影片變更事件，同一瀏覽器內的觀眾視窗監聽並重新渲染。
- `-gn` 的文字擷取使用 `pdfjs-dist` 的 legacy build，能在 Node 中執行而不需要 DOM 或 canvas。

## 開發

```bash
make install    # pnpm install
make build      # tsup 建置 → dist/
make check      # tsc --noEmit
make run        # 建置並以 test/fixtures/sample.pdf 執行
make clean      # 移除 dist/ 和 node_modules/
```

專案結構：

```
pdf-presenter/
├── bin/pdf-presenter.ts       # CLI 進入點
├── src/
│   ├── cli.ts                 # commander 設定、命令分派
│   ├── server.ts              # HTTP 伺服器與路由表
│   ├── generate-notes.ts      # -gn 指令
│   ├── utils.ts               # 路徑／連接埠輔助
│   └── ui/                    # 靜態前端
│       ├── audience.html
│       ├── presenter.html
│       ├── presenter.css
│       └── presenter.js       # pdf.js 渲染 + BroadcastChannel 同步
└── test/fixtures/             # 煙霧測試用 PDF 範例
```

## 授權

MIT
