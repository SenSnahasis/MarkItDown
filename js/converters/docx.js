// DOCX -> Markdown, via an HTML intermediate: mammoth.js turns the .docx
// into HTML (preserving headings/lists/tables), then Turndown turns that
// HTML into Markdown.

// turndown-plugin-gfm only converts a <table> to a Markdown pipe-table when
// its first row is made of <th> cells (see its isHeadingRow check). Mammoth
// never emits <th> — every cell is <td>, even for the visual header row —
// so without this promotion every table would silently fall back to raw
// HTML in the output, including plain multi-column data tables.
function promoteFirstRowToHeader(container) {
  container.querySelectorAll("table").forEach((table) => {
    const firstRow = table.rows[0];
    // Single-row tables are almost always pure layout (e.g. a logo banner)
    // rather than tabular data — leave those as-is instead of forcing a
    // header split that doesn't mean anything.
    if (!firstRow || table.rows.length < 2) return;
    if (firstRow.querySelector("th")) return; // already a real header

    Array.from(firstRow.children).forEach((td) => {
      if (td.tagName === "TH") return;
      const th = document.createElement("th");
      th.innerHTML = td.innerHTML;
      Array.from(td.attributes).forEach((attr) => th.setAttribute(attr.name, attr.value));
      td.replaceWith(th);
    });
  });
}

// turndown-plugin-gfm's tableCell rule emits cell content as-is with no
// trimming, assuming it's inline text. Mammoth wraps every cell's text in a
// <p>, and Turndown's own paragraph rule surrounds that with blank lines —
// which breaks the one-line-per-row requirement of a Markdown pipe-table.
// Unwrapping the <p> (joining multiple paragraphs in one cell with a space,
// since a pipe-table cell can't represent multiple paragraphs anyway) keeps
// each row on a single line.
function unwrapParagraphsInTableCells(container) {
  container.querySelectorAll("th, td").forEach((cell) => {
    const paragraphs = cell.querySelectorAll(":scope > p");
    paragraphs.forEach((p, index) => {
      if (index > 0) p.insertAdjacentText("beforebegin", " ");
      while (p.firstChild) p.parentNode.insertBefore(p.firstChild, p);
      p.remove();
    });
  });
}

const MIME_TO_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/x-emf": "emf",
  "image/x-wmf": "wmf",
};

// Mammoth embeds every image as a base64 `data:` URI on the <img> itself, so
// extracting the original bytes is just decoding that URI — no separate
// fetch or archive-walking needed.
function dataUriToBlob(dataUri) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUri || "");
  if (!match) return null;
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

// Mammoth's default image handling inlines every image as a base64 data URI
// directly in the HTML — for a document with several screenshots, that's
// tens/hundreds of KB of unreadable base64 text per image, dwarfing the
// actual document content and making the output look completely broken.
// Always strip the base64 itself out of the markdown; the only choice is
// what (if anything) replaces each image there — a short text placeholder,
// or nothing at all. Independently of that, the original bytes can be
// pulled out for a separate images.zip before the <img> is discarded.
function stripEmbeddedImages(container, { omitPlaceholders, extractImages }) {
  const imgElements = container.querySelectorAll("img");
  const extracted = [];
  imgElements.forEach((img, index) => {
    let filename = null;
    if (extractImages) {
      const decoded = dataUriToBlob(img.getAttribute("src"));
      if (decoded) {
        const ext = MIME_TO_EXTENSION[decoded.mimeType] || "bin";
        filename = `image-${index + 1}.${ext}`;
        extracted.push({ filename, blob: decoded.blob });
      }
    }
    if (omitPlaceholders) {
      img.remove();
      return;
    }
    const alt = (img.getAttribute("alt") || "").trim();
    // When the image was also exported to the zip, point the placeholder at
    // its exact filename rather than a generic label, so the two outputs
    // can be cross-referenced. Falls back to alt text / a generic label
    // whenever extraction is off or this particular image couldn't be
    // decoded (e.g. an unsupported embed format).
    const placeholderLabel = filename && alt ? `${filename} — ${alt}` : filename || alt || "embedded image";
    img.replaceWith(document.createTextNode(`[Image: ${placeholderLabel}]`));
  });
  return { count: imgElements.length, images: extracted };
}

// A paragraph or table cell that contained only an image collapses to empty
// once the <img> is removed — Turndown's emphasis/strong rules already
// return '' for empty content, so no stray "__"/"**" markers are left behind,
// but the surrounding blank lines still need collapsing.
function cleanupAfterOmittedImages(markdown) {
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
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
 * @param {{omitImageRefs?: boolean, extractImages?: boolean, isCancelled?: () => boolean}} [options]
 *   omitImageRefs: leave no trace of images at all, instead of the default
 *   "[Image: ...]" placeholder.
 *   extractImages: pull the original image bytes out separately so they can
 *   be offered as a downloadable zip, independent of the placeholder choice.
 * @returns {Promise<{markdown: string, warnings: string[], images: {filename: string, blob: Blob}[]}>}
 */
export async function convertDocxToMarkdown(arrayBuffer, options = {}) {
  const { omitImageRefs = false, extractImages = false, isCancelled } = options;
  throwIfCancelled(isCancelled);
  // mammoth.convertToHtml() is one atomic call with no mid-flight checkpoint —
  // Cancel can only take effect before it starts or once it resolves, not
  // partway through. For typical DOCX sizes this call finishes quickly
  // anyway, so that's rarely a noticeable gap in practice.
  const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer });
  throwIfCancelled(isCancelled);

  const container = document.createElement("div");
  container.innerHTML = html;
  promoteFirstRowToHeader(container);
  unwrapParagraphsInTableCells(container);
  const { count: imageCount, images } = stripEmbeddedImages(container, {
    omitPlaceholders: omitImageRefs,
    extractImages,
  });

  const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  if (window.turndownPluginGfm) {
    turndownService.use(window.turndownPluginGfm.gfm);
  }

  let markdown = turndownService.turndown(container).trim();
  if (omitImageRefs && imageCount > 0) {
    markdown = cleanupAfterOmittedImages(markdown);
  }

  const warnings = (messages || []).map((m) => m.message);
  if (imageCount > 0) {
    warnings.push(
      omitImageRefs
        ? `${imageCount} embedded image${imageCount === 1 ? "" : "s"} omitted entirely (no placeholder) to keep the file small and readable.`
        : `${imageCount} embedded image${imageCount === 1 ? "" : "s"} replaced with a text placeholder to keep the file small and readable.`
    );
  }
  if (extractImages && images.length > 0) {
    warnings.push(`${images.length} embedded image${images.length === 1 ? "" : "s"} available to download separately.`);
  }

  return { markdown, warnings, images };
}
