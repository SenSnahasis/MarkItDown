# PDF/DOCX → Markdown Converter

A browser-based tool that converts PDF and Word (DOCX) documents into clean Markdown. Everything runs client-side — no file is ever uploaded to a server.

## Why this exists

Feeding a raw PDF/DOCX file directly to an LLM (like Claude) is expensive, slow, and often produces worse results than feeding the same content as clean Markdown:

- **Token bloat** — headers/footers, style metadata, and layout artifacts get tokenized even though they add no value.
- **Context window pressure** — tokens spent on formatting noise are tokens not available for actual reasoning, which can mean a large document gets silently truncated.
- **Higher cost, slower runs** — more input tokens means higher API cost and longer response times, every time.
- **Inconsistent extraction quality** — messy raw text increases the odds of an LLM misreading structure or missing requirements, compared to clean Markdown with proper headings/lists/tables.
- **Data exposure risk** — most "convert for AI" tools online require uploading the file to a third-party server, which is often unacceptable for internal, client, or contractual documents.

This tool solves all five: it strips repeated headers/footers, normalizes structure into clean Markdown, and never leaves the user's browser.

## What it does

- Accepts one or more PDF/DOCX files via drag-and-drop or file picker — single files convert immediately, multiple files queue as a batch.
- Converts each file to Markdown entirely in-browser:
  - [pdf.js](https://mozilla.github.io/pdf.js/) for PDF text extraction
  - [Mammoth](https://github.com/mwilliamson/mammoth.js) for DOCX → HTML
  - [Turndown](https://github.com/mixmark-io/turndown) (+ GFM plugin) for HTML → GitHub-flavored Markdown
- Optionally strips repeated headers/footers (PDF), omits embedded image references (DOCX), and/or extracts embedded images.
- Shows a preview, a size comparison, and any extraction warnings.
- Lets you copy the result, download it as `.md`, or download a `.zip` bundle (markdown + extracted images) — with a combined `.zip` for a whole batch.
- Remembers your chosen options and light/dark theme, and keeps a local history of past conversions for quick re-download.
- Zero backend — runs as a static site, so there is no server-side storage, logging, or transmission of document contents.

## Running it

The app is a static site (`index.html` + `style.css` + `js/`) with no build step and no backend.

### With Docker

```
docker build -t <dockerhub-username>/markitdown:latest .
docker run -p 8080:80 <dockerhub-username>/markitdown:latest
```

Then open `http://localhost:8080`.

### Without Docker

Serve the folder with any static file server (or just open `index.html` directly in a browser).
