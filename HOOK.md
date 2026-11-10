# The Signals DevTools hook, version 1

A small contract between pages that use the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) and tools that inspect them. The proposal anticipates this: built-in Signals should let DevTools inspect the signal graph, "whether this is built into browsers or through a shared extension." This is a proposal for that shared surface. It names no framework.

## Who does what

- **The tool** (this extension, or any other) defines `globalThis.__SIGNALS_DEVTOOLS_HOOK__` before the page's scripts run.
- **The tool may also define `globalThis.Signal`**, as an instrumented implementation of the proposal's API. If the page already had one (a native `Signal`), the tool wraps it rather than replacing it.
- **Libraries and frameworks** need do nothing if they take the global when it exists:

  ```js
  import { Signal as Polyfill } from 'signal-polyfill';
  export const Signal = globalThis.Signal ?? Polyfill;
  ```

  This is the same line that lets them switch to a native `Signal` the day browsers ship one.

- **Runtimes that keep a private copy** register it, and the tool reads their graph through the proposal's own `Signal.subtle.introspectSources`:

  ```js
  globalThis.__SIGNALS_DEVTOOLS_HOOK__?.register({ name: 'my-runtime', Signal, watchers: [watcher] });
  ```

Everything is optional. Without the hook, the `?.` calls do nothing and production code pays nothing.

## The hook

| Member | For | Notes |
| --- | --- | --- |
| `version` | everyone | `1` |
| `Signal` | everyone | The instrumented API the tool supplied (identical in behavior to the one it wraps). |
| `register({ name, Signal, watchers })` | runtimes | Returns `{ addWatcher(watcher), dispose() }`. Signals are discovered from the watchers. Writes and runs aren't seen, only the graph and current values. |
| `label(signal, name)` | runtimes, apps | Readable names, since the proposal has no `name` option. Also read from `options.name` when a `State` or `Computed` is created with one. Returns the signal. |
| `ignoreFrames(...patterns)` | runtimes | URL patterns (regular expression sources) to look past when recording where a signal was created, so the location is the code calling the runtime. `/node_modules/` is ignored by default. |
| `snapshot(since?)` | tools | JSON: `{ version, base, provided, seq, settings, runtimes, nodes, edges, events, dropped }`. `events` are those after `since`. |
| `setValue(id, json)`, `log(id)`, `configure({ writeStacks })`, `clearEvents()` | tools | Driven from the DevTools panel. |

### What a snapshot holds

- `nodes`: `{ id, kind: 'state' | 'computed' | 'watcher', label, site: { url, line, column, fn } | null, runtime, value, error, unread, live, sets, runs, notifies, lastChange, causes }`. `value` is a short preview string. `causes` is, for a computed, the ids of its sources that changed since its previous run: why it last re-ran.
- `edges`: `[sourceId, sinkId]`, from `introspectSources`.
- `events`: `{ seq, t, type: 'create' | 'set' | 'run' | 'error' | 'notify', id, ... }`. A `set` has `from`, `to`, `changed`; a `run` has `causes`, `first`, `changed`, `ms`, `to`.

## Limits that come from the proposal, not the tool

- A computed is only tracked back from its sources (`introspectSinks`) while it's live, that is, while a Watcher depends on it. Unwatched readers are found only from their own side.
- The proposal has no write notification, so writes can only be seen on signals made by an instrumented `Signal`. That's why the tool supplies one rather than only reading.
- Signals made from a private copy that isn't registered are invisible.

Feedback on the shape is welcome as an issue, especially from anyone building on the proposal.
