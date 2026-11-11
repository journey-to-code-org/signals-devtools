# Privacy

Signals Inspector collects no data.

- It sends nothing anywhere. The extension makes no network requests, has no analytics, and has no server.
- What it reads stays on your computer. On the pages it runs on, it records the page's signals (their values, writes and dependencies) in that page's memory, and the DevTools panel reads them from there. The record is gone when the page is closed or reloaded.
- It stores one thing: the list of extra sites you add on its options page, kept by the browser as registered content scripts and host permissions. Removing a site there deletes it.
- It runs only on `localhost`, `*.localhost`, `127.0.0.1` and `file://` pages, and on sites you add yourself.

The Signals Playground page (the GitHub Pages site) also sends nothing. It saves your last unsaved code in your browser's local storage so it's there next time, and a Share link carries the code in the link itself.

Questions: open an issue at https://github.com/journey-to-code-org/signals-devtools/issues.
