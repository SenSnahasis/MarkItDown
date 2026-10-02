// All DOM rendering + event wiring lives here. app.js owns the actual
// conversion/storage logic and just calls into these functions.

const ACCEPTED_EXTENSIONS = [".pdf", ".docx"];

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const selectedFileEl = document.getElementById("selected-file");
const selectedFileNameEl = document.getElementById("selected-file-name");
const startConversionBtn = document.getElementById("start-conversion-btn");
const changeFileBtn = document.getElementById("change-file-btn");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const statusProgressFillEl = document.getElementById("status-progress-fill");
const cancelBtn = document.getElementById("cancel-btn");
const resultEl = document.getElementById("result");
const resultFilenameEl = document.getElementById("result-filename");
const resultTimestampEl = document.getElementById("result-timestamp");
const sizeStatEl = document.getElementById("size-stat");
const imagesUnavailableNoticeEl = document.getElementById("images-unavailable-notice");
const warningsEl = document.getElementById("warnings");
const previewEl = document.getElementById("preview");
const downloadBtn = document.getElementById("download-btn");
const copyBtn = document.getElementById("copy-btn");
const downloadBundleBtn = document.getElementById("download-bundle-btn");
const newFileBtn = document.getElementById("new-file-btn");
const errorEl = document.getElementById("error");
const errorMessageEl = document.getElementById("error-message");
const errorRetryBtn = document.getElementById("error-retry-btn");
const historyListEl = document.getElementById("history-list");
const historyEmptyEl = document.getElementById("history-empty");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const omitImageRefsCheckbox = document.getElementById("omit-image-refs-checkbox");
const stripHeadersFootersCheckbox = document.getElementById("strip-headers-footers-checkbox");
const extractImagesCheckbox = document.getElementById("extract-images-checkbox");
const appVersionEl = document.getElementById("app-version");
const resetAppBtn = document.getElementById("reset-app-btn");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const batchPanelEl = document.getElementById("batch-panel");
const batchCountEl = document.getElementById("batch-count");
const batchListEl = document.getElementById("batch-list");
const batchStartBtn = document.getElementById("batch-start-btn");
const batchCancelBtn = document.getElementById("batch-cancel-btn");
const batchClearBtn = document.getElementById("batch-clear-btn");
const batchSummaryEl = document.getElementById("batch-summary");
const batchSummaryTextEl = document.getElementById("batch-summary-text");
const batchDownloadAllBtn = document.getElementById("batch-download-all-btn");
const batchNewBtn = document.getElementById("batch-new-btn");

const BATCH_STATUS_LABEL = {
  pending: "Pending",
  converting: "Converting…",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

function hasAcceptedExtension(filename) {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

/**
 * @param {(files: File[]) => void} onFiles Called with one or more accepted
 *   files — the caller decides whether one file takes the single-file path
 *   or multiple take the batch path.
 */
export function bindFileInput(onFiles) {
  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const accepted = files.filter((f) => hasAcceptedExtension(f.name));
    if (accepted.length === 0) {
      showError("Unsupported file type. Please upload .pdf or .docx files.");
      return;
    }
    onFiles(accepted);
  }

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files);
    fileInput.value = ""; // allow re-selecting the same file(s) later
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    handleFiles(e.dataTransfer.files);
  });
}

/** Briefly swaps a button's label to give feedback, then restores it. */
function flashButtonText(btn, text) {
  const original = btn.dataset.originalText || btn.textContent;
  btn.dataset.originalText = original;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}

export function bindActions({ onDownload, onDownloadBundle, onCopy, onNewFile, onRetry, onStartConversion, onChangeFile, onCancel }) {
  downloadBtn.addEventListener("click", onDownload);
  downloadBundleBtn.addEventListener("click", onDownloadBundle);
  copyBtn.addEventListener("click", async () => {
    try {
      await onCopy();
      flashButtonText(copyBtn, "Copied!");
    } catch {
      flashButtonText(copyBtn, "Copy failed");
    }
  });
  newFileBtn.addEventListener("click", onNewFile);
  errorRetryBtn.addEventListener("click", onRetry);
  startConversionBtn.addEventListener("click", onStartConversion);
  changeFileBtn.addEventListener("click", onChangeFile);
  cancelBtn.addEventListener("click", onCancel);
}

export function setVersion(version) {
  appVersionEl.textContent = `v${version}`;
}

export function bindFooterActions({ onReset }) {
  resetAppBtn.addEventListener("click", () => {
    if (
      confirm(
        "Reset all app data? This clears your conversion history and can't be undone."
      )
    ) {
      onReset();
    }
  });
}

/** Forces a specific theme via [data-theme] on <html>, or clears it to follow the OS setting (theme === null). */
export function applyTheme(theme) {
  if (theme) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

/** Updates the toggle switch's position/label to reflect which theme is currently effective. */
export function setThemeIcon(effectiveTheme) {
  const isDark = effectiveTheme === "dark";
  themeToggleBtn.setAttribute("aria-checked", String(isDark));
  themeToggleBtn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

export function bindThemeToggle(onToggle) {
  themeToggleBtn.addEventListener("click", onToggle);
}

export function bindHistoryActions({ onSelect, onDelete, onClearAll }) {
  historyListEl.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".history-item-delete");
    const item = e.target.closest(".history-item");
    if (!item) return;
    const id = item.dataset.id;
    if (deleteBtn) {
      e.stopPropagation();
      if (confirm("Delete this conversion from history?")) onDelete(id);
    } else {
      onSelect(id);
    }
  });
  clearHistoryBtn.addEventListener("click", () => {
    if (confirm("Clear all conversion history?")) onClearAll();
  });
}

/** Whether image references should be omitted entirely, with no placeholder (DOCX only). */
export function getOmitImageRefs() {
  return omitImageRefsCheckbox.checked;
}

/** Whether repeated headers/footers should be detected and stripped (PDF only). */
export function getStripHeadersFooters() {
  return stripHeadersFootersCheckbox.checked;
}

/** Whether embedded images should be extracted for a separate downloadable ZIP (PDF & DOCX). */
export function getExtractImages() {
  return extractImagesCheckbox.checked;
}

/** Applies previously-saved checkbox settings on load. Missing keys keep the HTML defaults. */
export function applySettings(settings) {
  if (typeof settings.omitImageRefs === "boolean") omitImageRefsCheckbox.checked = settings.omitImageRefs;
  if (typeof settings.stripHeadersFooters === "boolean") stripHeadersFootersCheckbox.checked = settings.stripHeadersFooters;
  if (typeof settings.extractImages === "boolean") extractImagesCheckbox.checked = settings.extractImages;
}

/** Calls onChange with the current settings object whenever any option-toggle checkbox changes. */
export function bindSettingsChange(onChange) {
  const emit = () =>
    onChange({
      omitImageRefs: omitImageRefsCheckbox.checked,
      stripHeadersFooters: stripHeadersFootersCheckbox.checked,
      extractImages: extractImagesCheckbox.checked,
    });
  omitImageRefsCheckbox.addEventListener("change", emit);
  stripHeadersFootersCheckbox.addEventListener("change", emit);
  extractImagesCheckbox.addEventListener("change", emit);
}

/** Confirms with the user before proceeding on a large file. Returns boolean. */
export function confirmLargeFile(sizeMb) {
  return confirm(
    `This file is ${sizeMb.toFixed(1)}MB and may take a while or make the page briefly unresponsive. Continue?`
  );
}

/** File has been picked but conversion hasn't started — waits for the Start button. */
export function showFileSelected(filename) {
  dropZone.hidden = true;
  selectedFileEl.hidden = false;
  selectedFileNameEl.textContent = filename;
  statusEl.hidden = true;
  resultEl.hidden = true;
  errorEl.hidden = true;
  batchPanelEl.hidden = true;
}

export function showConverting(filename) {
  dropZone.hidden = true;
  selectedFileEl.hidden = true;
  resultEl.hidden = true;
  errorEl.hidden = true;
  batchPanelEl.hidden = true;
  statusEl.hidden = false;
  statusTextEl.textContent = `Converting ${filename}…`;
  // Starts indeterminate (sliding segment) since page counts aren't known
  // yet — PDF conversion switches this to a real percentage via
  // updateProgress() once page 1 resolves; a DOCX conversion is one atomic
  // call with no per-page checkpoint, so it just stays indeterminate.
  statusProgressFillEl.classList.add("indeterminate");
  statusProgressFillEl.style.width = "";
}

export function updateProgress(page, total) {
  statusTextEl.textContent = `Converting… processing page ${page} of ${total}`;
  statusProgressFillEl.classList.remove("indeterminate");
  statusProgressFillEl.style.width = `${Math.round((page / total) * 100)}%`;
}

export function showResult({ filename, createdAt, markdown, warnings, originalSizeBytes, images, hadExtractedImages }) {
  dropZone.hidden = false;
  dropZone.classList.remove("disabled");
  selectedFileEl.hidden = true;
  statusEl.hidden = true;
  errorEl.hidden = true;
  batchPanelEl.hidden = true;

  resultFilenameEl.textContent = filename;
  resultTimestampEl.textContent = formatRelativeTime(createdAt);
  previewEl.value = markdown;

  if (typeof originalSizeBytes === "number") {
    const outputBytes = new Blob([markdown]).size;
    const delta = originalSizeBytes > 0 ? Math.round((1 - outputBytes / originalSizeBytes) * 100) : 0;
    const changeText =
      delta > 0 ? `${delta}% smaller` : delta < 0 ? `${Math.abs(delta)}% larger` : "same size";
    sizeStatEl.innerHTML = `${formatBytes(originalSizeBytes)} → <strong>${formatBytes(outputBytes)}</strong> (${changeText})`;
    sizeStatEl.hidden = false;
  } else {
    sizeStatEl.hidden = true; // older history entries saved before this field existed
  }

  if (warnings && warnings.length > 0) {
    warningsEl.hidden = false;
    warningsEl.textContent =
      `Converted successfully. A few source styles/elements weren't recognized ` +
      `and were skipped or simplified — your content is intact: ${warnings.join(" · ")}`;
  } else {
    warningsEl.hidden = true;
  }

  // History entries loaded from localStorage never carry `images` (see
  // app.js) — hide the button rather than let it try to zip nothing.
  const hasImages = images && images.length > 0;
  if (hasImages) {
    downloadBundleBtn.hidden = false;
    downloadBundleBtn.textContent = `Download bundle (.zip, ${images.length} image${images.length === 1 ? "" : "s"})`;
  } else {
    downloadBundleBtn.hidden = true;
  }

  // hadExtractedImages is persisted per history entry even though the image
  // bytes themselves aren't — it's what lets a reopened entry recognize that
  // its markdown's [Image: ...] placeholders name files that no longer have
  // a zip behind them, instead of silently going quiet about it.
  imagesUnavailableNoticeEl.hidden = !hadExtractedImages || hasImages;

  resultEl.hidden = false;
}

export function showError(message) {
  dropZone.hidden = false;
  dropZone.classList.remove("disabled");
  selectedFileEl.hidden = true;
  statusEl.hidden = true;
  resultEl.hidden = true;
  batchPanelEl.hidden = true;
  errorMessageEl.textContent = message;
  errorEl.hidden = false;
}

export function resetToIdle() {
  dropZone.hidden = false;
  dropZone.classList.remove("disabled");
  selectedFileEl.hidden = true;
  statusEl.hidden = true;
  resultEl.hidden = true;
  errorEl.hidden = true;
  batchPanelEl.hidden = true;
}

export function renderHistory(entries) {
  historyListEl.innerHTML = "";
  historyEmptyEl.hidden = entries.length > 0;

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.dataset.id = entry.id;
    li.tabIndex = 0;

    const badge = document.createElement("span");
    badge.className = "history-item-badge";
    badge.textContent = entry.sourceType;

    const info = document.createElement("div");
    info.className = "history-item-info";
    const nameEl = document.createElement("span");
    nameEl.className = "history-item-name";
    nameEl.textContent = entry.filename;
    nameEl.title = entry.filename; // full name on hover, since it's often truncated with an ellipsis
    const timeEl = document.createElement("span");
    timeEl.className = "history-item-time";
    timeEl.textContent = formatRelativeTime(entry.createdAt);
    info.append(nameEl, timeEl);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "history-item-delete";
    deleteBtn.setAttribute("aria-label", `Delete ${entry.filename} from history`);
    deleteBtn.textContent = "×";

    li.append(badge, info, deleteBtn);
    historyListEl.appendChild(li);
  }
}

/** Builds one <li> for the batch queue, reflecting that item's current status. */
function buildBatchItem(item, index) {
  const li = document.createElement("li");
  li.className = "batch-item";
  li.dataset.index = String(index);

  const name = document.createElement("span");
  name.className = "batch-item-name";
  name.textContent = item.file.name;
  name.title = item.file.name; // full name on hover, since it's often truncated with an ellipsis
  li.append(name);

  const status = document.createElement("span");
  status.className = `batch-item-status batch-item-status-${item.status}`;
  status.textContent =
    item.status === "failed" && item.error ? `Failed: ${item.error}` : BATCH_STATUS_LABEL[item.status];
  li.append(status);

  if (item.status === "pending") {
    const removeBtn = document.createElement("button");
    removeBtn.className = "batch-item-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${item.file.name} from queue`);
    li.append(removeBtn);
  } else if (item.status === "done") {
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "btn btn-text batch-item-download";
    downloadBtn.textContent = "Download";
    li.append(downloadBtn);
  }

  return li;
}

export function renderBatchList(queue) {
  batchCountEl.textContent = String(queue.length);
  batchListEl.innerHTML = "";
  queue.forEach((item, index) => batchListEl.appendChild(buildBatchItem(item, index)));
}

/** Re-renders a single queue row in place, once its status changes. */
export function updateBatchItem(index, item) {
  const li = batchListEl.querySelector(`[data-index="${index}"]`);
  if (!li) return;
  li.replaceWith(buildBatchItem(item, index));
}

/** Shows the queue in its pre-start state: full list, "Convert all" available. */
export function showBatchQueue(queue) {
  dropZone.hidden = true;
  selectedFileEl.hidden = true;
  statusEl.hidden = true;
  resultEl.hidden = true;
  errorEl.hidden = true;
  batchPanelEl.hidden = false;
  batchSummaryEl.hidden = true;
  batchStartBtn.hidden = false;
  batchCancelBtn.hidden = true;
  batchClearBtn.hidden = false;
  renderBatchList(queue);
}

/** Switches the queue into its running state: no more editing, cancel available. */
export function showBatchRunning() {
  batchStartBtn.hidden = true;
  batchCancelBtn.hidden = false;
  batchClearBtn.hidden = true;
}

export function showBatchSummary(queue) {
  batchCancelBtn.hidden = true;
  const done = queue.filter((item) => item.status === "done").length;
  const failed = queue.filter((item) => item.status === "failed").length;
  const skipped = queue.filter((item) => item.status === "skipped").length;

  let text = `${done} of ${queue.length} converted successfully.`;
  if (failed > 0) text += ` ${failed} failed.`;
  if (skipped > 0) text += ` ${skipped} skipped.`;
  batchSummaryTextEl.textContent = text;

  batchDownloadAllBtn.hidden = done === 0;
  batchSummaryEl.hidden = false;
}

export function resetBatch() {
  batchPanelEl.hidden = true;
  batchListEl.innerHTML = "";
  batchSummaryEl.hidden = true;
}

export function bindBatchActions({ onStart, onCancel, onClear, onNew, onDownloadAll, onRemoveItem, onDownloadItem }) {
  batchStartBtn.addEventListener("click", onStart);
  batchCancelBtn.addEventListener("click", onCancel);
  batchClearBtn.addEventListener("click", onClear);
  batchNewBtn.addEventListener("click", onNew);
  batchDownloadAllBtn.addEventListener("click", onDownloadAll);
  batchListEl.addEventListener("click", (e) => {
    const li = e.target.closest(".batch-item");
    if (!li) return;
    const index = Number(li.dataset.index);
    if (e.target.closest(".batch-item-remove")) onRemoveItem(index);
    else if (e.target.closest(".batch-item-download")) onDownloadItem(index);
  });
}
