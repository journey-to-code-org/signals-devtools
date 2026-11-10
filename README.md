# Signals Playground

Tools for seeing the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) at work, built on one inspector core:

- **[The playground](https://journey-to-code-org.github.io/signals-playground/)**: write code against `Signal` in the browser and watch its dependency graph update as it runs. Nothing to install.
- **Signals Inspector**, a browser extension: a DevTools panel that shows every `Signal.State`, `Signal.Computed` and `Signal.subtle.Watcher` on a page, how they depend on each other, every write, and why each computed last re-ran. It isn't tied to any framework: anything built on the proposal's API can be inspected.

The proposal says built-in Signals should let DevTools inspect the signal graph, "whether this is built into browsers or through a shared extension." The extension is an attempt at that shared extension, and at the small [hook](HOOK.md) that lets a page and a tool find each other.

## What you get

- **Signals**: a live table of every signal with its value, write or run count, and whether a Watcher depends on it. Rows flash when they change.
- **Detail**: where the signal was created (click to open the source), its value, what it reads, what reads it, and its recent history. A computed says which sources changed to make it re-run. A state can be set from the panel, to try the graph out.
- **Graph**: the dependency graph laid out left to right, from states to watchers. Selecting a signal highlights everything upstream and downstream.
- **Timeline**: writes, runs (with their causes and timing), errors and watcher notifications, as sentences: "subtotal → 36 because qty changed".

## How it gets in

There's no global list of signals on a page, so the extension provides one. Before any page script runs, it puts an instrumented `Signal` on `globalThis`: the [reference polyfill](https://github.com/proposal-signals/signal-polyfill), or the browser's native `Signal` if there is one, with each class subclassed to report what happens. Instances are still instances of the real classes and every `Signal.subtle` function is the original, so code can't tell the difference.

That means:

- **Code that takes the global when it exists is inspected with no changes**: `globalThis.Signal ?? polyfill`. That's also what lets it switch to a native `Signal` later.
- **Code that imports a private copy** can register it: `globalThis.__SIGNALS_DEVTOOLS_HOOK__?.register({ name, Signal, watchers })`. Its graph is then read through the proposal's own `introspectSources`, though its writes aren't seen. See [HOOK.md](HOOK.md).
- **You can try the API in the console** on any inspected page: `new Signal.State(1)` works with nothing installed.

It runs on `localhost`, `*.localhost`, `127.0.0.1` and `file://` pages. Other sites, such as a staging server, can be added in the extension's options; the browser asks for permission for each one.

Signals have no names in the proposal. The inspector names each one after where it was created, looking past `node_modules` so a framework's helper isn't the answer. Give one a better name with `{ name: 'total' }` in its options or with `__SIGNALS_DEVTOOLS_HOOK__?.label(signal, 'total')`.

## Try it

```sh
npm install
npm run build        # bundles the page hook into extension/hook.js, zips dist/
npm run demo         # http://127.0.0.1:4173/demo/
```

Load `extension/` as an unpacked extension (Chrome or Edge: `chrome://extensions`, Developer mode, Load unpacked; Firefox 128+: `about:debugging`, Load Temporary Add-on, pick `extension/manifest.json`). Open the demo, open DevTools, and pick the **Signals** panel.

## Playground

`playground/` is a page for trying the proposal with nothing installed: write code against `Signal`, and the same inspector core draws its graph as it runs. A write sends a pulse along each edge whose source made the next node re-run, so equality cut-off, glitch-free diamonds, laziness and dynamic dependencies are visible rather than described. It ships with examples for each, and Share puts the code in the link.

```sh
npm run build:playground   # dist/playground/index.html, one self-contained file
```

The `Playground` workflow deploys it to GitHub Pages on every push to `main`.

## Tests

```sh
npm test                 # the page hook and the panel's model, in Node
npm run test:browser     # loads the extension in Chromium and drives the demo and the panel
npm run test:playground  # runs every playground example in Chromium (build it first)
```

`test:browser` needs a Chromium that can load unpacked extensions (Chrome for Testing or Chromium; branded Chrome can't). Point `CHROME` at it if Playwright's own isn't installed.

## Layout

- `src/core.js`: the instrumented API and the hook, with no browser or extension code.
- `src/hook.js`: the content script entry, bundled with the polyfill into `extension/hook.js`.
- `extension/`: the manifest, the DevTools panel (`panel.*`, `model.js`) and the options page.
- `demo/`: a page that uses only `globalThis.Signal`.
- `playground/`: the playground (`main.js`, `examples.js`), built by `scripts/build-playground.js`.

## Status

0.1. The proposal is at Stage 1 and its API can change; this follows `signal-polyfill` 0.2.2.

## License

MIT. The bundled `signal-polyfill` is Apache-2.0.
