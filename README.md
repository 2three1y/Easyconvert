## Easyconvert Readme

Easyconvert is an accessibility-first, 100% client-side reader for your Claude data export and a batch converter for JSON, CSV, Markdown, HTML, Word and plain-text files.

## How to use it

Open the GitHub pages URL. Its below the description (for mobile) and will allow you to use this tool on the web

Note: You can also Click
[Here](https://2three1y.github.io/Easyconvert/)
# Directions
1. Go to the link above
2. Select one or more files from Google Drive, the files app for iOS etc, or drag and drop them. All providers should be supported
3. If one of them is your Claude export (the .zip Claude emails you, or the conversations.json inside it), it opens in the reader
4. To convert files, choose an output type. You can have your output become Word (DOCX), PDF, HTML, Markdown, TXT, JSON or CSV

Once done, Select the "Convert files" button
Note: Every file gets its own progress bar and a small chime when it finishes, and a bigger chime plays when they are all done. Results are keyboard-friendly sections with preview, copy and download actions. The actions are under a file actions heading. "Download all" saves everything as one ZIP

## Reading your Claude export

- Search every conversation by title, or by the full text of every message
- Filter by the date a conversation started, and sort by newest, oldest, longest or title
- Each message is its own article with a "You" or "Claude" heading, so the VoiceOver rotor and the H key jump between messages
- Code blocks, lists, tables, quotes and links are shown properly, with a copy button on every code block and every message
- Download one conversation as Markdown, Text, HTML, Word or PDF, or use "Print or save as PDF". You can also download every conversation that matches your filters as a ZIP
- Projects and their documents from projects.json are listed too
- Big exports are fine: 2,000 conversations open in well under a second, and the list shows 100 at a time with a "Show more" button

Keyboard: press / to jump to the search field. On a phone-sized screen, Escape or "Back to conversations" goes back to the list.

## Sounds

Easyconvert has soft classic system-style chimes, made live in the browser with no audio files. There is a small chime when a file converts, a bigger one when everything is done, a gentle low tone if a file fails, and soft ticks at 25, 50 and 75 percent. The "Sounds on/off" switch and the volume slider at the top are remembered. Nothing plays until you click, tap or press a key.

## PRIVACY AND ACCESSIBILITY

Easyconvert reads files with the browser File API and processes them in memory. Nothing is uploaded, transmitted, tracked, or sent to a server. There are no external dependencies or network requests. ZIP files are read and written by Easyconvert itself, and the page's Content Security Policy blocks network connections. It also works when you download the repo and open index.html straight from your computer. The interface uses ARIA landmarks, skip links, semantic headings and lists, live status announcements, expandable previews, keyboard navigation, visible focus states, reduced motion, dark mode and responsive styling

Word files are real Office Open XML documents with Heading styles, real lists, header rows on tables, a monospace Code style, a title, and the document language set, so they work well with screen readers and Word's Navigation pane.

## Files

- index.html: the page
- css/easyconvert.css: the styles
- js/app.js: the reader, converter, progress and announcements
- js/claude.js: reads Claude exports
- js/convert.js: turns files into each output format
- js/docx.js, js/pdf.js: Word and PDF writers
- js/markdown.js: safe Markdown reader
- js/zip.js: ZIP reader and writer
- js/sound.js: the chimes

## License

This project is licensed under the MIT License. See the LICENSE file for details.
# #Thank You :)
Thank you for using this tool. I hope you like it
