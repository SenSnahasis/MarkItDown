import { convertDocxToMarkdown } from "./converters/docx.js";
import { convertPdfToMarkdown } from "./converters/pdf.js";
import * as storage from "./storage.js";
import * as ui from "./ui.js";

// Bump this on every release that changes behavior visible in the UI — it's
// shown in the footer so a browser holding onto an old cached copy is
// distinguishable from the version actually deployed.
const APP_VERSION = "3.0.0";

const LARGE_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const MIN_CONTENT_LENGTH = 20; // guards against "technically nonzero but meaningless" output

const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function effectiveTheme() {
  return storage.getTheme() || (systemPrefersDark.matches ? "dark" : "light");
}

let currentResult = null; // { filename, sourceType, createdAt, markdown, warnings, originalSizeBytes }
let pendingFile = null; // File selected but not yet converted, waiting on the Start button
let activeCancelToken = null; // { cancelled: boolean } for the in-flight conversion, if any

let batchQueue = []; // [{ file, status: "pending"|"converting"|"done"|"failed"|"skipped", result: {markdown, images, warnings}|null, error: string|null }]
let batchCancelled = false;

function sourceTypeFor(filename) {
  return filename.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
}

function baseNameFor(originalName) {
  const dotIndex = originalName.lastIndexOf(".");
  return dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
}

function markdownFilenameFor(originalName) {
  return `${baseNameFor(originalName)}.md`;
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
    const extractImages = ui.getExtractImages();
    const { markdown, warnings, images } =
      sourceType === "pdf"
        ? await convertPdfToMarkdown(arrayBuffer, {
            onProgress: (page, total) => ui.updateProgress(page, total),
            stripHeadersFooters: ui.getStripHeadersFooters(),
            extractImages,
            isCancelled: () => token.cancelled,
          })
        : await convertDocxToMarkdown(arrayBuffer, {
            omitImageRefs: ui.getOmitImageRefs(),
            extractImages,
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

    const hadExtractedImages = Boolean(images && images.length > 0);
    const createdAt = new Date().toISOString();
    const saved = storage.saveEntry({
      filename: file.name,
      sourceType,
      markdown,
      originalSizeBytes: file.size,
      hadExtractedImages,
    });

    currentResult = {
      filename: file.name,
      sourceType,
      createdAt: saved ? saved.createdAt : createdAt,
      markdown,
      warnings,
      originalSizeBytes: file.size,
      // Extracted image bytes are kept in memory only, not persisted to
      // localStorage history — Blobs aren't JSON-serializable, and the
      // history store's small quota (storage.js) can't afford raw image
      // bytes on top of the markdown it already keeps per entry.
      images: images || [],
      hadExtractedImages,
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

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadCurrentResult() {
  if (!currentResult) return;
  triggerDownload(new Blob([currentResult.markdown], { type: "text/markdown" }), markdownFilenameFor(currentResult.filename));
}

async function copyCurrentResult() {
  if (!currentResult) return;
  await navigator.clipboard.writeText(currentResult.markdown);
}

async function downloadBundle() {
  if (!currentResult || !currentResult.images || currentResult.images.length === 0) return;
  const zip = new JSZip();
  const baseName = baseNameFor(currentResult.filename);
  zip.file(`${baseName}.md`, currentResult.markdown);
  const imagesFolder = zip.folder("images");
  currentResult.images.forEach((image) => imagesFolder.file(image.filename, image.blob));
  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `${baseName}-bundle.zip`);
}

function startBatchQueue(files) {
  batchQueue = files.map((file) => ({ file, status: "pending", result: null, error: null }));
  batchCancelled = false;
  ui.showBatchQueue(batchQueue);
}

function removeBatchItem(index) {
  if (!batchQueue[index] || batchQueue[index].status !== "pending") return;
  batchQueue.splice(index, 1);
  if (batchQueue.length === 0) {
    resetBatchQueue();
  } else {
    ui.renderBatchList(batchQueue);
  }
}

function downloadBatchItem(index) {
  const item = batchQueue[index];
  if (!item || item.status !== "done") return;
  triggerDownload(new Blob([item.result.markdown], { type: "text/markdown" }), markdownFilenameFor(item.file.name));
}

// Runs the queue sequentially rather than in parallel — every conversion
// below is CPU-heavy work on the main thread (PDF text/image extraction,
// mammoth's HTML conversion), so overlapping them would just contend for the
// same thread while making cancellation and per-item progress harder to
// reason about, with no real speed gain.
async function runBatch() {
  ui.showBatchRunning();

  for (let i = 0; i < batchQueue.length; i++) {
    const item = batchQueue[i];

    if (batchCancelled) {
      if (item.status === "pending") {
        item.status = "skipped";
        ui.updateBatchItem(i, item);
      }
      continue;
    }

    item.status = "converting";
    ui.updateBatchItem(i, item);

    try {
      const sourceType = sourceTypeFor(item.file.name);
      const arrayBuffer = await item.file.arrayBuffer();
      const extractImages = ui.getExtractImages();
      const { markdown, warnings, images } =
        sourceType === "pdf"
          ? await convertPdfToMarkdown(arrayBuffer, {
              stripHeadersFooters: ui.getStripHeadersFooters(),
              extractImages,
              isCancelled: () => batchCancelled,
            })
          : await convertDocxToMarkdown(arrayBuffer, {
              omitImageRefs: ui.getOmitImageRefs(),
              extractImages,
              isCancelled: () => batchCancelled,
            });

      if (markdown.trim().length < MIN_CONTENT_LENGTH) {
        throw new Error(
          sourceType === "pdf" ? "no extractable text (scanned/image-only?)" : "no content extracted"
        );
      }

      const hadExtractedImages = Boolean(images && images.length > 0);
      const saved = storage.saveEntry({
        filename: item.file.name,
        sourceType,
        markdown,
        originalSizeBytes: item.file.size,
        hadExtractedImages,
      });

      item.status = "done";
      item.result = {
        markdown,
        images: images || [],
        warnings,
        createdAt: saved ? saved.createdAt : new Date().toISOString(),
      };
    } catch (err) {
      item.status = err && err.cancelled ? "skipped" : "failed";
      item.error = err && err.cancelled ? "cancelled" : err && err.message ? err.message : "conversion failed";
    }

    ui.updateBatchItem(i, item);
  }

  refreshHistory();
  ui.showBatchSummary(batchQueue);
}

async function downloadBatchZip() {
  const doneItems = batchQueue.filter((item) => item.status === "done");
  if (doneItems.length === 0) return;
  const zip = new JSZip();
  doneItems.forEach((item) => {
    const base = baseNameFor(item.file.name);
    const folder = zip.folder(base);
    folder.file(`${base}.md`, item.result.markdown);
    if (item.result.images.length > 0) {
      const imagesFolder = folder.folder("images");
      item.result.images.forEach((image) => imagesFolder.file(image.filename, image.blob));
    }
  });
  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `batch-${doneItems.length}-file${doneItems.length === 1 ? "" : "s"}.zip`);
}

function resetBatchQueue() {
  batchQueue = [];
  batchCancelled = false;
  ui.resetBatch();
  ui.resetToIdle();
}

function init() {
  ui.setVersion(APP_VERSION);
  ui.applySettings(storage.getSettings());
  ui.bindSettingsChange((settings) => storage.saveSettings(settings));

  // Passing storage.getTheme() (rather than effectiveTheme()) leaves
  // [data-theme] unset when the user has no saved preference, so the
  // stylesheet's prefers-color-scheme media query keeps following the OS
  // live — only an explicit toggle click should pin the theme.
  ui.applyTheme(storage.getTheme());
  ui.setThemeIcon(effectiveTheme());
  systemPrefersDark.addEventListener("change", () => {
    if (!storage.getTheme()) ui.setThemeIcon(effectiveTheme());
  });
  ui.bindThemeToggle(() => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    storage.saveTheme(next);
    ui.applyTheme(next);
    ui.setThemeIcon(next);
  });

  ui.bindFileInput((files) => {
    if (files.length === 1) {
      pendingFile = files[0];
      ui.showFileSelected(files[0].name);
    } else {
      startBatchQueue(files);
    }
  });

  ui.bindActions({
    onDownload: downloadCurrentResult,
    onDownloadBundle: downloadBundle,
    onCopy: copyCurrentResult,
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

  ui.bindBatchActions({
    onStart: runBatch,
    onCancel: () => {
      batchCancelled = true;
    },
    onClear: resetBatchQueue,
    onNew: resetBatchQueue,
    onDownloadAll: downloadBatchZip,
    onRemoveItem: removeBatchItem,
    onDownloadItem: downloadBatchItem,
  });

  ui.bindFooterActions({
    onReset: () => {
      storage.resetAll();
      // A full reload guarantees every in-memory/UI state (checkboxes,
      // current result, pending file) goes back to a first-load default,
      // rather than trying to individually unwind each one here.
      window.location.reload();
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
