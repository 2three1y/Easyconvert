# EasyConvert

EasyConvert is an accessibility-first, 100% client-side batch converter for Claude exports, CSV files, and plain-text files.

## Use it

Open `index.html` locally or publish the repository with GitHub Pages. Select one or more `.json`, `.csv`, `.txt`, or `.log` files, choose the target format, and convert. Results are keyboard-friendly collapsible sections with copy and download actions. Multi-file conversions can be downloaded as a ZIP containing `THANK_YOU.txt`.

Supported output formats include Clean Text / Markdown, HTML, DOCX-compatible formatted text, beautified JSON, and CSV. CSV input is parsed locally with quoted-field and newline handling; HTML output includes an accessible table with a caption, column headers, and scoped cells.

## Privacy and accessibility

EasyConvert reads files with the browser File API and processes them in memory. Nothing is uploaded, transmitted, tracked, or sent to a server. There are no external dependencies or network requests. The interface uses ARIA landmarks, semantic headings and lists, live status announcements, strict accordion attributes, keyboard navigation, visible focus states, and responsive high-contrast styling.

## License

Provided as-is for personal use.
