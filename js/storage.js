// localStorage-backed history of past conversions.
// Each entry stores the FULL generated markdown so a past conversion can be
// reopened/re-downloaded without re-uploading the original file.

const STORAGE_KEY = "pdf2md.history";
const SETTINGS_KEY = "pdf2md.settings";
const THEME_KEY = "pdf2md.theme";
const MAX_ENTRIES = 20;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4MB, conservative vs. the ~5-10MB per-origin quota
const MAX_WRITE_RETRIES = 20;

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or legacy-shaped data — treat as empty rather than crashing.
    return [];
  }
}

function writeRaw(history) {
  let remaining = history.slice();
  for (let attempt = 0; attempt <= MAX_WRITE_RETRIES; attempt++) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
      return remaining;
    } catch (err) {
      const isQuotaError =
        err && (err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014);
      if (!isQuotaError || remaining.length === 0) {
        // Not a quota problem, or nothing left to evict — give up silently.
        // The caller (saveEntry) treats a failed write as non-fatal.
        return null;
      }
      // Evict the oldest entry (last in a newest-first array) and retry.
      remaining = remaining.slice(0, -1);
    }
  }
  return null;
}

function enforceLimits(history) {
  // history is newest-first. Evict oldest until both limits hold.
  let trimmed = history.slice(0, MAX_ENTRIES);
  let totalBytes = trimmed.reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
  while (totalBytes > MAX_TOTAL_BYTES && trimmed.length > 0) {
    const removed = trimmed.pop();
    totalBytes -= removed.sizeBytes || 0;
  }
  return trimmed;
}

function makeId() {
  return `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Returns history newest-first. Never throws. */
export function getHistory() {
  return readRaw();
}

/** Looks up a single entry by id, or null if not found. */
export function getEntry(id) {
  return readRaw().find((e) => e.id === id) || null;
}

/**
 * Saves a new conversion into history, applying eviction rules.
 * Returns the saved entry, or null if the write ultimately failed
 * (e.g. localStorage disabled/full even after evicting everything) —
 * callers must not treat that as blocking the actual file download.
 */
export function saveEntry({ filename, sourceType, markdown, originalSizeBytes, hadExtractedImages }) {
  const entry = {
    id: makeId(),
    filename,
    sourceType,
    createdAt: new Date().toISOString(),
    markdown,
    sizeBytes: new Blob([markdown]).size,
    originalSizeBytes,
    // Only a flag, never the image bytes themselves — those aren't kept in
    // history (see app.js), but remembering that this conversion *had* them
    // lets the UI warn that the markdown's [Image: ...] references point at
    // files that can no longer be re-downloaded from this entry.
    hadExtractedImages: !!hadExtractedImages,
  };

  const current = readRaw();
  const next = enforceLimits([entry, ...current]);
  const written = writeRaw(next);
  return written ? entry : null;
}

export function deleteEntry(id) {
  const current = readRaw();
  const next = current.filter((e) => e.id !== id);
  writeRaw(next);
}

export function clearAll() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — nothing more we can do
  }
}

/** Returns the last-saved option-toggle settings, or {} if none saved yet. */
export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore — non-fatal, just means the setting won't persist this time
  }
}

/** Returns "light" | "dark" if the user explicitly picked one, otherwise null (follow the OS setting). */
export function getTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore — non-fatal, just means the choice won't persist this time
  }
}

// Distinct from clearAll(): wipes the entire origin's localStorage, not just
// this app's history key. Used by the footer's "Reset app data" button to
// recover from a browser that's still holding onto state saved by an older
// deployed version, rather than assuming today's code is the only thing that
// ever wrote to this origin's storage.
export function resetAll() {
  try {
    localStorage.clear();
  } catch {
    // ignore — nothing more we can do
  }
}
