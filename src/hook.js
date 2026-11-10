// Runs in the page's own world before any of its scripts (a MAIN-world content script at
// document_start). It bundles the reference polyfill so every page has a `Signal`:
//
//   - If the page has no `globalThis.Signal`, it gets an instrumented one. Code that takes the
//     global when it exists (`globalThis.Signal ?? polyfill`, as the proposal suggests and as
//     Zubra's runtime does) is inspected with no integration at all, and the console can be used
//     to try the API out.
//   - If the browser ships a native `Signal`, the instrumentation wraps the native classes.
//   - Code that imports a private copy can call `__SIGNALS_DEVTOOLS_HOOK__.register(...)`.
import { Signal as Polyfill } from 'signal-polyfill';
import { createInspector } from './core.js';

if (!globalThis.__SIGNALS_DEVTOOLS_HOOK__) {
  const native = globalThis.Signal;
  const { Signal, hook } = createInspector(native ?? Polyfill, { base: native ? 'native' : 'polyfill' });
  Object.defineProperty(globalThis, 'Signal', { value: Signal, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(globalThis, '__SIGNALS_DEVTOOLS_HOOK__', { value: hook, configurable: true, enumerable: false });
}
