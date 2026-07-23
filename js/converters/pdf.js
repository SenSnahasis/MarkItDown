// PDF -> Markdown. PDFs carry no semantic structure, so headings are
// inferred from a font-size heuristic (coarse, two levels only) unless
// disabled via options.detectHeadings = false, which falls back to plain
// per-page paragraphs under a "## Page N" heading. Running headers/footers
// (page titles, page numbers, disclaimers repeated on most pages) are
// detected and dropped unless options.stripHeadersFooters = false.

const Y_EPSILON = 2; // px tolerance for "same line"
const HEADING1_RATIO = 1.5;
const HEADING2_RATIO = 1.15;
const PARAGRAPH_GAP_MULTIPLIER = 1.4;
const MARGIN_FRACTION = 0.1; // top/bottom 10% of the page counts as a margin zone
const MIN_PAGES_FOR_MARGIN_DETECTION = 3; // "repeats across pages" is meaningless below this
const REPETITION_FRACTION = 0.5; // a margin line must repeat on >=50% of pages to count as running header/footer

function median(numbers) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Groups a page's text items into lines (by shared y-position), top-to-bottom. */
function extractPageLines(textContent) {
  const lines = [];
  for (const item of textContent.items) {
    const text = item.str;
    if (!text || !text.trim()) continue;
    const y = item.transform[5];
    const height = Math.abs(item.transform[3]) || 1;
    let line = lines.find((l) => Math.abs(l.y - y) <= Y_EPSILON);
    if (!line) {
      line = { y, height, parts: [] };
      lines.push(line);
    } else {
      line.height = Math.max(line.height, height);
    }
    line.parts.push(text);
  }
  return lines
    .map((l) => ({ y: l.y, height: l.height, text: l.parts.join(" ").replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text.length > 0)
    .sort((a, b) => b.y - a.y); // PDF y grows upward -> descending y = top to bottom
}

/** Collapses digits so "Page 3 of 45" and "Page 4 of 46" compare as the same running text. */
function normalizeForRepetition(text) {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * Detects and removes running headers/footers: lines sitting in the page's
 * top/bottom margin band whose (digit-normalized) text repeats across at
 * least half the pages. Position alone isn't enough (real body text can
 * start near the top margin) and repetition alone isn't enough (a short
 * document might never repeat anything) — combining both is what makes this
 * reliable. This is a heuristic: a heading that legitimately repeats near a
 * page edge (e.g. "Chapter 1" atop every page of that chapter) can still be
 * misclassified as a footer/header.
 * @returns {{pageLineSets: Array, removedCount: number}}
 */
function stripRunningHeadersFooters(pageLineSets, pageHeights) {
  const numPages = pageLineSets.length;
  if (numPages < MIN_PAGES_FOR_MARGIN_DETECTION) {
    return { pageLineSets, removedCount: 0 };
  }

  const isInMargin = (line, pageHeight) =>
    pageHeight > 0 && (line.y >= pageHeight * (1 - MARGIN_FRACTION) || line.y <= pageHeight * MARGIN_FRACTION);

  const signatureToPages = new Map();
  pageLineSets.forEach((lines, pageIndex) => {
    const pageHeight = pageHeights[pageIndex] || 0;
    lines.forEach((line) => {
      if (!isInMargin(line, pageHeight)) return;
      const signature = normalizeForRepetition(line.text);
      if (!signature) return;
      if (!signatureToPages.has(signature)) signatureToPages.set(signature, new Set());
      signatureToPages.get(signature).add(pageIndex);
    });
  });

  const requiredPages = Math.max(2, Math.ceil(numPages * REPETITION_FRACTION));
  const repeatingSignatures = new Set(
    Array.from(signatureToPages.entries())
      .filter(([, pages]) => pages.size >= requiredPages)
      .map(([signature]) => signature)
  );

  if (repeatingSignatures.size === 0) {
    return { pageLineSets, removedCount: 0 };
  }

  let removedCount = 0;
  const filtered = pageLineSets.map((lines, pageIndex) => {
    const pageHeight = pageHeights[pageIndex] || 0;
    return lines.filter((line) => {
      if (!isInMargin(line, pageHeight)) return true;
      const isRunning = repeatingSignatures.has(normalizeForRepetition(line.text));
      if (isRunning) removedCount++;
      return !isRunning;
    });
  });

  return { pageLineSets: filtered, removedCount };
}

/** Renders one page's classified lines into a markdown fragment. */
function renderPage(lines, medianHeight, detectHeadings) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  const typicalGap = median(gaps) || 1;

  const blocks = [];
  let currentParagraph = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ratio = medianHeight > 0 ? line.height / medianHeight : 1;

    let kind = "body";
    if (detectHeadings) {
      if (ratio >= HEADING1_RATIO) kind = "h1";
      else if (ratio >= HEADING2_RATIO) kind = "h2";
    }

    if (kind === "h1" || kind === "h2") {
      currentParagraph = null;
      blocks.push({ kind, text: line.text });
      continue;
    }

    const gapFromPrev = i > 0 ? lines[i - 1].y - line.y : Infinity;
    const isNewParagraph = !currentParagraph || gapFromPrev > typicalGap * PARAGRAPH_GAP_MULTIPLIER;

    if (isNewParagraph) {
      currentParagraph = { kind: "body", text: line.text };
      blocks.push(currentParagraph);
    } else {
      currentParagraph.text += ` ${line.text}`;
    }
  }

  return blocks
    .map((b) => (b.kind === "h1" ? `# ${b.text}` : b.kind === "h2" ? `## ${b.text}` : b.text))
    .join("\n\n");
}

function throwIfCancelled(isCancelled) {
  if (isCancelled && isCancelled()) {
    const err = new Error("Conversion cancelled");
    err.cancelled = true;
    throw err;
  }
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {{onProgress?: (page: number, total: number) => void, detectHeadings?: boolean, stripHeadersFooters?: boolean, isCancelled?: () => boolean}} [options]
 * @returns {Promise<{markdown: string, warnings: string[]}>}
 */
export async function convertPdfToMarkdown(arrayBuffer, options = {}) {
  const { onProgress, detectHeadings = true, stripHeadersFooters = true, isCancelled } = options;

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageLineSets = [];
  const pageHeights = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    // Per-page loop is the only safe interruption point — checking here
    // (rather than only once up front) lets Cancel take effect mid-document
    // on large PDFs instead of waiting for every page to finish first.
    throwIfCancelled(isCancelled);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    pageLineSets.push(extractPageLines(textContent));
    pageHeights.push(page.view[3] - page.view[1]);
    if (onProgress) onProgress(pageNum, pdf.numPages);
  }

  let effectiveLineSets = pageLineSets;
  let removedCount = 0;
  if (stripHeadersFooters) {
    const result = stripRunningHeadersFooters(pageLineSets, pageHeights);
    effectiveLineSets = result.pageLineSets;
    removedCount = result.removedCount;
  }

  const allHeights = effectiveLineSets.flat().map((l) => l.height);
  const medianHeight = median(allHeights);

  const pageFragments = effectiveLineSets.map((lines) =>
    lines.length === 0 ? "" : renderPage(lines, medianHeight, detectHeadings)
  );

  const markdown = pageFragments
    .map((fragment, i) => {
      const pageHeader = detectHeadings ? `<!-- page ${i + 1} -->` : `## Page ${i + 1}`;
      return fragment ? `${pageHeader}\n\n${fragment}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const warnings = [];
  if (removedCount > 0) {
    warnings.push(
      `Removed ${removedCount} repeated header/footer line${removedCount === 1 ? "" : "s"} detected across the document.`
    );
  }

  return { markdown, warnings };
}
