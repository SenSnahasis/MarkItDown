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

    // An inline image marker (see extractPageImages) — not real text, so it
    // skips heading-ratio classification and, like a heading, breaks
    // whatever paragraph was accumulating around it.
    if (line.isImage) {
      currentParagraph = null;
      blocks.push({ kind: "image", text: line.text });
      continue;
    }

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

/** Merges per-page image markers into that page's text lines, sorted top-to-bottom like the lines already are. */
function mergeImageMarkers(lines, images) {
  if (images.length === 0) return lines;
  const markers = images.map((img) => ({ y: img.y, isImage: true, text: `[Image: ${img.filename}]` }));
  return [...lines, ...markers].sort((a, b) => b.y - a.y);
}

function throwIfCancelled(isCancelled) {
  if (isCancelled && isCancelled()) {
    const err = new Error("Conversion cancelled");
    err.cancelled = true;
    throw err;
  }
}

const MIN_EXTRACTED_IMAGE_DIMENSION = 8; // px — filters out 1px stencil/bullet artifacts, not real pictures

// Raw XObject image data comes back as packed pixel bytes (grayscale/RGB/RGBA
// depending on the source image), not a ready-made image file — a canvas is
// the only browser-native way to turn arbitrary pixel data into a PNG blob.
function rasterToCanvas({ width, height, kind, data }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const out = imageData.data;
  const { ImageKind } = pdfjsLib;

  if (kind === ImageKind.RGBA_32BPP) {
    out.set(data);
  } else if (kind === ImageKind.RGB_24BPP) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
      out[j + 3] = 255;
    }
  } else if (kind === ImageKind.GRAYSCALE_1BPP) {
    const bytesPerRow = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * bytesPerRow + (x >> 3)];
        const value = (byte >> (7 - (x & 7))) & 1 ? 255 : 0;
        const j = (y * width + x) * 4;
        out[j] = out[j + 1] = out[j + 2] = value;
        out[j + 3] = 255;
      }
    }
  } else {
    return null; // unrecognized packed format — skip rather than render garbage
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function bitmapToCanvas(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas;
}

// page.objs.get() resolves an image XObject to one of a few shapes depending
// on pdf.js's decode path: a ready HTMLCanvasElement/ImageBitmap, a wrapper
// object exposing a `.bitmap` (pdf.js 3.x's own createImageBitmap result,
// used whenever the browser's native decoder could handle the image), or —
// only when no native decode was possible — a raw packed-pixel object with a
// `kind` tag that rasterToCanvas() knows how to unpack.
function imageObjToCanvas(obj) {
  if (!obj) return null;
  if (obj instanceof HTMLCanvasElement) return obj;
  if (typeof ImageBitmap !== "undefined" && obj instanceof ImageBitmap) {
    return bitmapToCanvas(obj);
  }
  if (obj.bitmap) {
    return bitmapToCanvas(obj.bitmap);
  }
  if (obj.data && obj.width && obj.height) {
    return rasterToCanvas(obj);
  }
  return null;
}

const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

// PDF's "cm" operator prepends a matrix to the current transform: for a
// point p, p' = p * M * CTM. Concatenating M and CTM up front (rather than
// applying them one at a time per point) is what lets a single running
// `ctm` variable answer "where is the current drawing operation, in page
// space" at any point while replaying the operator list.
function concatMatrix(m, ctm) {
  return [
    m[0] * ctm[0] + m[1] * ctm[2],
    m[0] * ctm[1] + m[1] * ctm[3],
    m[2] * ctm[0] + m[3] * ctm[2],
    m[2] * ctm[1] + m[3] * ctm[3],
    m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
    m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
  ];
}

/**
 * Extracts every embedded picture XObject on a page as a PNG blob, plus the
 * page-space y-coordinate of its top edge. An image XObject is always
 * painted into the unit square, so replaying the same save/restore/"cm"
 * operators the content stream uses (mirroring how pdf.js's own renderer
 * tracks the CTM) and running the square's top-left corner (0,1) through
 * the CTM at the moment of painting gives that y — which lets the caller
 * splice an inline "[Image: ...]" marker into the reconstructed text at
 * roughly the right spot instead of only at the end of the page.
 */
async function extractPageImages(page, pageNum, isCancelled) {
  const opList = await page.getOperatorList();
  const { OPS } = pdfjsLib;
  const seenObjIds = new Set();
  const images = [];
  let imageIndex = 0;

  let ctm = IDENTITY_MATRIX;
  const ctmStack = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    throwIfCancelled(isCancelled);
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      ctmStack.push(ctm);
      continue;
    }
    if (fn === OPS.restore) {
      ctm = ctmStack.pop() || IDENTITY_MATRIX;
      continue;
    }
    if (fn === OPS.transform) {
      ctm = concatMatrix(args, ctm);
      continue;
    }
    // Deliberately excludes paintImageMaskXObject: stencil masks back text
    // rendering and shading fills, not standalone pictures — including them
    // would flood the zip with meaningless 1-bit noise.
    if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject) continue;

    const objId = args[0];
    if (typeof objId !== "string" || seenObjIds.has(objId)) continue;
    seenObjIds.add(objId);

    const obj = await new Promise((resolve) => {
      try {
        page.objs.get(objId, resolve);
      } catch {
        resolve(null);
      }
    });
    const canvas = imageObjToCanvas(obj);
    if (!canvas || canvas.width < MIN_EXTRACTED_IMAGE_DIMENSION || canvas.height < MIN_EXTRACTED_IMAGE_DIMENSION) {
      continue;
    }

    imageIndex++;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) continue;
    const topY = ctm[3] + ctm[5]; // (0,1) through the CTM: y' = 0*b + 1*d + f
    images.push({ filename: `page-${pageNum}-image-${imageIndex}.png`, blob, y: topY });
  }

  return images;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {{onProgress?: (page: number, total: number) => void, detectHeadings?: boolean, stripHeadersFooters?: boolean, extractImages?: boolean, isCancelled?: () => boolean}} [options]
 * @returns {Promise<{markdown: string, warnings: string[], images: {filename: string, blob: Blob}[]}>}
 */
export async function convertPdfToMarkdown(arrayBuffer, options = {}) {
  const { onProgress, detectHeadings = true, stripHeadersFooters = true, extractImages = false, isCancelled } = options;

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageLineSets = [];
  const pageHeights = [];
  const pageImageSets = [];
  const images = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    // Per-page loop is the only safe interruption point — checking here
    // (rather than only once up front) lets Cancel take effect mid-document
    // on large PDFs instead of waiting for every page to finish first.
    throwIfCancelled(isCancelled);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    pageLineSets.push(extractPageLines(textContent));
    pageHeights.push(page.view[3] - page.view[1]);
    if (extractImages) {
      const pageImages = await extractPageImages(page, pageNum, isCancelled);
      pageImageSets.push(pageImages);
      images.push(...pageImages.map(({ filename, blob }) => ({ filename, blob })));
    } else {
      pageImageSets.push([]);
    }
    if (onProgress) onProgress(pageNum, pdf.numPages);
  }

  let effectiveLineSets = pageLineSets;
  let removedCount = 0;
  if (stripHeadersFooters) {
    const result = stripRunningHeadersFooters(pageLineSets, pageHeights);
    effectiveLineSets = result.pageLineSets;
    removedCount = result.removedCount;
  }

  // Median line height is computed from real text only — image markers
  // carry no font size, and mixing in their zero/undefined height would
  // skew the heading-detection ratio for every other line on the page.
  const allHeights = effectiveLineSets.flat().map((l) => l.height);
  const medianHeight = median(allHeights);

  const renderedLineSets = effectiveLineSets.map((lines, pageIndex) => mergeImageMarkers(lines, pageImageSets[pageIndex]));

  const pageFragments = renderedLineSets.map((lines) =>
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
  if (extractImages && images.length > 0) {
    warnings.push(`${images.length} embedded image${images.length === 1 ? "" : "s"} available to download separately.`);
  }

  return { markdown, warnings, images };
}
