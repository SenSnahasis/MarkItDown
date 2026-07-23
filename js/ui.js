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
const cancelBtn = document.getElementById("cancel-btn");
const resultEl = document.getElementById("result");
const resultFilenameEl = document.getElementById("result-filename");
const resultTimestampEl = document.getElementById("result-timestamp");
const sizeStatEl = document.getElementById("size-stat");
const warningsEl = document.getElementById("warnings");
const previewEl = document.getElementById("preview");
const downloadBtn = document.getElementById("download-btn");
const newFileBtn = document.getElementById("new-file-btn");
const errorEl = document.getElementById("error");
const errorMessageEl = document.getElementById("error-message");
const errorRetryBtn = document.getElementById("error-retry-btn");
const historyListEl = document.getElementById("history-list");
const historyEmptyEl = document.getElementById("history-empty");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const omitImageRefsCheckbox = document.getElementById("omit-image-refs-checkbox");
const stripHeadersFootersCheckbox = document.getElementById("strip-headers-footers-checkbox");

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

export function bindFileInput(onFile) {
  function handleFile(file) {
    if (!file) return;
    if (!hasAcceptedExtension(file.name)) {
      showError("Unsupported file type. Please upload a .pdf or .docx file.");
      return;
    }
    onFile(file);
  }

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    handleFile(fileInput.files[0]);
    fileInput.value = ""; // allow re-selecting the same file later
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
    handleFile(e.dataTransfer.files[0]);
  });
}

export function bindActions({ onDownload, onNewFile, onRetry, onStartConversion, onChangeFile, onCancel }) {
  downloadBtn.addEventListener("click", onDownload);
  newFileBtn.addEventListener("click", onNewFile);
  errorRetryBtn.addEventListener("click", onRetry);
  startConversionBtn.addEventListener("click", onStartConversion);
  changeFileBtn.addEventListener("click", onChangeFile);
  cancelBtn.addEventListener("click", onCancel);
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
}

export function showConverting(filename) {
  dropZone.hidden = true;
  selectedFileEl.hidden = true;
  resultEl.hidden = true;
  errorEl.hidden = true;
  statusEl.hidden = false;
  statusTextEl.textContent = `Converting ${filename}…`;
}

export function updateProgress(page, total) {
  statusTextEl.textContent = `Converting… processing page ${page} of ${total}`;
}

export function showResult({ filename, createdAt, markdown, warnings, originalSizeBytes }) {
  dropZone.hidden = false;
  dropZone.classList.remove("disabled");
  selectedFileEl.hidden = true;
  statusEl.hidden = true;
  errorEl.hidden = true;

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

  resultEl.hidden = false;
}

export function showError(message) {
  dropZone.hidden = false;
  dropZone.classList.remove("disabled");
  selectedFileEl.hidden = true;
  statusEl.hidden = true;
  resultEl.hidden = true;
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
