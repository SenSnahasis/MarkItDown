// Pins the pdf.js worker to the same version as the core library loaded in
// index.html. Must run after the pdf.js <script> tag and before any module
// that calls pdfjsLib.getDocument(...).
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
