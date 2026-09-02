# Claude Archive Reader

An accessibility-first, 100% client-side reader for Claude data exports.

## Use it

1. Open `index.html` locally, or publish the repository with GitHub Pages.
2. Choose the `conversations.json` file from a Claude export, or drag it into the load area.
3. Select a conversation, optionally filter by title/message text or date, then copy or download its text.

The application expects Claude's exported array of conversation objects, including `uuid`, `name`, `created_at`, `updated_at`, and `chat_messages`. Each message may contain `sender`, `text`, and `created_at`.

## Privacy and offline behavior

Parsing happens in memory with the browser File API. The file is never uploaded, sent to a server, or tracked. There are no external dependencies, network requests, cookies, analytics, or tracking scripts.

## Accessibility

The interface uses semantic headings and lists, ARIA landmarks, live status announcements, keyboard-friendly controls, visible focus indicators, high contrast, responsive layout, and clear message labels for screen readers and Braille displays.

## License

Provided as-is for personal use.
