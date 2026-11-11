# Store listing

The text and answers for the Chrome Web Store, Microsoft Edge Add-ons and addons.mozilla.org, kept here so each store gets the same words and the next version's submission is copy and paste. Images are in `images/` (made by `shoot.mjs`).

## Name

Signals Inspector

## Summary (132 characters max)

See the TC39 Signals on any page: the dependency graph, every write, and why each computed re-ran. Works with any framework.

## Description

Signals Inspector is a DevTools panel for the TC39 Signals proposal. It shows every Signal.State, Signal.Computed and Signal.subtle.Watcher on a page, how they depend on each other, every write, and why each computed last re-ran.

It isn't tied to a framework. Anything built on the proposal's API can be inspected: your own code, a library, or a framework that uses Signals underneath.

What's in the panel:
• Signals: a live table of every signal with its value, its writes or runs, and whether a Watcher depends on it.
• Detail: where a signal was created (click to open the source), its value, what it reads, what reads it, and its recent history. A computed says which sources changed to make it re-run. You can set a State from the panel to try things out.
• Graph: the dependency graph from states to watchers. Selecting a signal highlights everything upstream and downstream.
• Timeline: writes, runs with their causes and timing, errors and watcher notifications, written as sentences: "subtotal → 36 because qty changed".

How it gets in: before the page's scripts run, the extension provides an instrumented globalThis.Signal (the reference polyfill, or the browser's native Signal if there is one). Code written as `globalThis.Signal ?? polyfill`, the way the proposal suggests, is inspected with no changes. Runtimes that keep a private copy can register with one line; the hook is documented in the repository.

It runs on localhost, *.localhost, 127.0.0.1 and file:// pages. Add other sites, such as a staging server, on the options page.

No data leaves your computer. No analytics, no network requests.

Try the API without installing anything in the Signals Playground: https://journey-to-code-org.github.io/signals-devtools/
Source and docs: https://github.com/journey-to-code-org/signals-devtools

## Category

- Chrome Web Store: Developer Tools
- Edge Add-ons: Developer tools
- addons.mozilla.org: Web Development

## Links

- Homepage: https://github.com/journey-to-code-org/signals-devtools
- Support: https://github.com/journey-to-code-org/signals-devtools/issues
- Privacy policy: https://github.com/journey-to-code-org/signals-devtools/blob/main/PRIVACY.md

## Chrome Web Store: Privacy practices tab

**Single purpose:** Inspect the TC39 Signals (Signal.State, Signal.Computed, Signal.subtle.Watcher) used by the web page you're developing, in a DevTools panel.

**Permission justifications:**

- `scripting`: Used only by the options page, when the developer adds a site to inspect: it registers the extension's own content script (hook.js) for that site, so the page gets the instrumented Signal before its scripts run. Removing the site unregisters it.
- Host permission (the content script's matches: localhost, *.localhost, 127.0.0.1, file://): The content script provides an instrumented globalThis.Signal before the page's own scripts run, so the DevTools panel can show the page's signals. It's limited to local development addresses by default.
- Optional host permission (`<all_urls>`): Requested one site at a time from the options page, only when the developer adds that site (for example a staging server). Nothing is requested at install.

**Remote code:** No, I am not using remote code. All code is in the package.

**Data usage:** Check none of the boxes. Then certify all three statements (not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending).

## Firefox: notes for reviewers

The extension's hook.js is bundled by esbuild from src/ and the signal-polyfill package (not minified). The source is attached, and BUILDING.md lists the commands: `npm ci && npm run build`, Node 22 or later. Everything else in the package is committed as it ships.

The content script runs in the page's MAIN world at document_start because its job is to define globalThis.Signal before the page's scripts read it. It makes no network requests and collects no data (data_collection_permissions: none).

To test: run `npm run demo` in the source, open http://127.0.0.1:4173/demo/, open DevTools and choose the Signals panel.
