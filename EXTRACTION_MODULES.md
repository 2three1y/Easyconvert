# Document extraction modules

The PDF and PPTX adapters are lazy-loaded modules exposing canHandle(file), process(file, options, progressCallback), dispose(), and getAccessibilitySummary().

PDF uses a local PDF.js worker and reports page progress. The application must bundle vendor/pdfjs/pdf.mjs and vendor/pdfjs/pdf.worker.mjs before enabling PDF extraction.

PPTX uses the existing local JSZip runtime to inspect slide XML and notes XML, preserving slide boundaries as Markdown headings.

Both adapters are intended to be loaded only after a matching file is selected. Progress messages should be forwarded to an aria-live="polite" region and focus should move to the result/status region after completion or error.
