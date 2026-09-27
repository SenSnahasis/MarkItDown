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

## Where it's used

It's a preprocessing step that sits in front of any AI workflow that consumes a document:

```
[Source PDF/DOCX] → [This tool: browser-based conversion] → [Clean .md file] → [Fed to Claude / any LLM] → [Task output]
```

Typical use cases:

- **Test case generation** from requirements documents — strips formatting overhead before Claude reasons about the actual requirements.
- **Contract / SOW review and summarization** — gives legal/PM teams a clean, consistently structured view of clauses without uploading the contract to a third-party service.
- **RFP / proposal analysis** — lets an LLM process a full RFP in one pass instead of hitting context limits partway through.
- **Meeting minutes, SOPs, and policy documents → knowledge base ingestion** — clean Markdown headings make better chunk boundaries for RAG pipelines.
- **Design/spec documents → code or documentation generation** — Markdown section headings map reliably to what the AI references (e.g. "per section 3.2").
- **Compliance / audit document review** — safe to use on sensitive or regulated documents since nothing is ever uploaded.

## What it does

- Accepts a PDF or DOCX file via drag-and-drop or file picker.
- Converts it to Markdown entirely in-browser:
  - [pdf.js](https://mozilla.github.io/pdf.js/) for PDF text extraction
  - [Mammoth](https://github.com/mwilliamson/mammoth.js) for DOCX → HTML
  - [Turndown](https://github.com/mixmark-io/turndown) (+ GFM plugin) for HTML → GitHub-flavored Markdown
- Optionally strips repeated headers/footers (PDF) and optionally omits embedded image references (DOCX).
- Optionally extracts embedded images as a downloadable ZIP.
- Shows a preview, a size comparison, and any extraction warnings.
- Lets you download the result as a `.md` file, and keeps a local history of past conversions for quick re-download.
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

## Project structure

```
index.html            App shell / UI markup
style.css             Styling
js/app.js             App entry point / wiring
js/ui.js              UI event handling and rendering
js/storage.js         Local conversion history (browser storage)
js/vendor-config.js   pdf.js worker configuration
js/converters/pdf.js  PDF → Markdown conversion logic
js/converters/docx.js DOCX → Markdown conversion logic
Dockerfile            nginx:alpine static file server
```
