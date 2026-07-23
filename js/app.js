import { convertDocxToMarkdown } from "./converters/docx.js";
import { convertPdfToMarkdown } from "./converters/pdf.js";
import * as storage from "./storage.js";
import * as ui from "./ui.js";

const LARGE_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const MIN_CONTENT_LENGTH = 20; // guards against "technically nonzero but meaningless" output

let currentResult = null; // { filename, sourceType, createdAt, markdown, warnings, originalSizeBytes }
let pendingFile = null; // File selected but not yet converted, waiting on the Start button
let activeCancelToken = null; // { cancelled: boolean } for the in-flight conversion, if any

function sourceTypeFor(filename) {
  return filename.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
}

function markdownFilenameFor(originalName) {
  const dotIndex = originalName.lastIndexOf(".");
  const base = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
  return `${base}.md`;
}

function refreshHistory() {
  ui.renderHistory(storage.getHistory());
}

async function convertFile(file) {
  if (file.size > LARGE_FILE_BYTES) {
    const proceed = ui.confirmLargeFile(file.size / (1024 * 1024));
    if (!proceed) return;
  }

  const sourceType = sourceTypeFor(file.name);
  const token = { cancelled: false };
  activeCancelToken = token;
  ui.showConverting(file.name);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const { markdown, warnings } =
      sourceType === "pdf"
        ? await convertPdfToMarkdown(arrayBuffer, {
            onProgress: (page, total) => ui.updateProgress(page, total),
            stripHeadersFooters: ui.getStripHeadersFooters(),
            isCancelled: () => token.cancelled,
          })
        : await convertDocxToMarkdown(arrayBuffer, {
            omitImageRefs: ui.getOmitImageRefs(),
            isCancelled: () => token.cancelled,
          });

    if (markdown.trim().length < MIN_CONTENT_LENGTH) {
      const message =
        sourceType === "pdf"
          ? "No extractable text was found in this PDF. It may be scanned/image-only — this app can't OCR images."
          : "No content could be extracted from this document.";
      ui.showError(message);
      return;
    }

    const createdAt = new Date().toISOString();
    const saved = storage.saveEntry({
      filename: file.name,
      sourceType,
      markdown,
      originalSizeBytes: file.size,
    });

    currentResult = {
      filename: file.name,
      sourceType,
      createdAt: saved ? saved.createdAt : createdAt,
      markdown,
      warnings,
      originalSizeBytes: file.size,
    };

    ui.showResult(currentResult);
    refreshHistory();
  } catch (err) {
    if (err && err.cancelled) {
      ui.resetToIdle();
      return;
    }
    console.error(err);
    if (err && err.name === "PasswordException") {
      ui.showError("This PDF is password-protected and can't be processed in the browser.");
    } else {
      ui.showError(
        "This file couldn't be read — it may be corrupted or not a valid PDF/DOCX."
      );
    }
  } finally {
    activeCancelToken = null;
  }
}

function downloadCurrentResult() {
  if (!currentResult) return;
  const blob = new Blob([currentResult.markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = markdownFilenameFor(currentResult.filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function init() {
  ui.bindFileInput((file) => {
    pendingFile = file;
    ui.showFileSelected(file.name);
  });

  ui.bindActions({
    onDownload: downloadCurrentResult,
    onNewFile: () => {
      currentResult = null;
      ui.resetToIdle();
    },
    onRetry: () => ui.resetToIdle(),
    onStartConversion: () => {
      if (!pendingFile) return;
      const file = pendingFile;
      pendingFile = null;
      convertFile(file);
    },
    onChangeFile: () => {
      pendingFile = null;
      ui.resetToIdle();
    },
    onCancel: () => {
      if (activeCancelToken) activeCancelToken.cancelled = true;
    },
  });

  ui.bindHistoryActions({
    onSelect: (id) => {
      const entry = storage.getEntry(id);
      if (!entry) return;
      currentResult = entry;
      ui.showResult(entry);
    },
    onDelete: (id) => {
      storage.deleteEntry(id);
      refreshHistory();
    },
    onClearAll: () => {
      storage.clearAll();
      refreshHistory();
    },
  });

  refreshHistory();
}

init();
