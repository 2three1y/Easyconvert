# Claude Export Converter

An accessibility-first, 100% client-side batch converter for Claude data exports.

## Use it

1. Open `index.html` locally, or publish the repository with GitHub Pages.
2. Choose one or more Claude export files, or drag and drop them into the upload area.
3. Remove individual files if needed, select the target format, and choose Convert.
4. Expand any converted file in the results accordion to preview, copy, or download it.

Supported output formats:

- Clean Text / Markdown (`.txt`)
- HTML (`.html`)
- DOCX-compatible formatted document (`.docx`)
- Beautified JSON (`.json`)
- CSV metadata/table export (`.csv`)

## Privacy and offline behavior

Files are read with the browser File API and processed in memory. They are never uploaded, sent to a server, or tracked. There are no external dependencies, network requests, cookies, analytics, or tracking scripts.

## Accessibility

The interface includes ARIA landmarks, semantic headings and lists, strict accordion attributes (`aria-expanded` and `aria-controls`), live announcements for file changes and conversion completion, keyboard navigation, visible high-contrast focus states, and responsive layout.

## License

Provided as-is for personal use.
