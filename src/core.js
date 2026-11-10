// The inspector's page side, independent of any browser or framework.
//
// `createInspector(Base)` takes a TC39 Signals implementation (a native `Signal`, the reference
// polyfill, or any other implementation of the proposal's API) and returns:
//
//   - `Signal`: the same API, made of subclasses of `Base`'s classes that report what happens
//     (creation, writes, computed re-runs and their causes, watcher notifications). Code that
//     uses it can't tell the difference: instances are still `instanceof Base.State` etc., and
//     every `Signal.subtle` function is `Base`'s own.
//   - `hook`: what DevTools reads, as plain JSON (`snapshot()`), plus `register()` for runtimes
//     that keep a private copy of the API. Their signals can't report writes, but the graph
//     behind their watchers is read with the proposal's own `introspectSources`.
//
// Nothing here is kept alive by the inspector: nodes are held through WeakRefs and dropped when
// collected.

export const HOOK_VERSION = 1;
const MAX_EVENTS = 2000;
const MAX_NODES = 2000;
const MARK = Symbol.for('signals-inspector');

export function createInspector(Base, { base = 'unknown', now = () => performance.now() } = {}) {
  if (!Base?.State || !Base?.Computed || !Base?.subtle?.Watcher) {
    throw new TypeError('createInspector needs an implementation of the Signals API');
  }

  // ---- registry ------------------------------------------------------------------------------

  let nextId = 1;
  let seq = 0; // increases with every event; lastChange/lastRun are compared against it
  const ids = new WeakMap(); // signal → id
  const nodes = new Map(); // id → meta
  const events = [];
  const gone = new FinalizationRegistry((id) => nodes.delete(id));
  const runtimes = []; // { name, Signal, watchers: Set<WeakRef> }
  const settings = { writeStacks: false, ignore: ['/node_modules/'] };
  let ignored = [];
  const compileIgnore = () => {
    ignored = settings.ignore.map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        return { test: (url) => url.includes(pattern) };
      }
    });
  };
  compileIgnore();

  const ownUrl = ownLocation();
  // Frames to look past when naming where a signal was made: this file, and libraries (by
  // default anything under node_modules, so a framework's `state()` helper isn't the answer).
  const own = { url: ownUrl, skip: (url) => ignored.some((re) => re.test(url)) };

  function track(signal, kind, options, runtime = null, impl = Base) {
    let id = ids.get(signal);
    if (id) return nodes.get(id);
    id = nextId++;
    ids.set(signal, id);
    const meta = {
      id,
      kind,
      ref: new WeakRef(signal),
      impl,
      runtime,
      label: labelFrom(options),
      site: runtime ? null : callSite(own),
      equals: typeof options?.equals === 'function' ? options.equals : Object.is,
      created: seq,
      sets: 0,
      runs: 0,
      notifies: 0,
      lastChange: -1,
      lastRun: -1,
      hasValue: false,
      value: undefined,
      error: null,
      causes: [],
    };
    nodes.set(id, meta);
    gone.register(signal, id);
    if (!runtime) record('create', meta, {});
    return meta;
  }

  const metaOf = (signal) => {
    const id = signal && ids.get(signal);
    return id ? nodes.get(id) : undefined;
  };

  function record(type, meta, data) {
    const event = { seq: ++seq, t: Math.round(now() * 100) / 100, type, id: meta.id, ...data };
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    return event;
  }

  const untracked = (impl, fn) => {
    try {
      return { ok: true, value: impl.subtle.untrack(fn) };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const sourcesOf = (impl, signal) => {
    try {
      return impl.subtle.introspectSources(signal);
    } catch {
      return [];
    }
  };
  const sinksOf = (impl, signal) => {
    try {
      return impl.subtle.introspectSinks(signal);
    } catch {
      return [];
    }
  };

  // ---- the instrumented API ------------------------------------------------------------------

  class State extends Base.State {
    constructor(value, options) {
      super(value, options);
      track(this, 'state', options);
    }

    set(value) {
      const meta = metaOf(this) ?? track(this, 'state');
      const before = untracked(Base, () => super.get());
      super.set(value); // throws during a watcher notification, before anything is recorded
      meta.sets++;
      let changed = true;
      if (before.ok) {
        try {
          changed = !meta.equals.call(this, before.value, value);
        } catch {
          changed = true;
        }
      }
      const event = record('set', meta, {
        from: before.ok ? preview(before.value) : '?',
        to: preview(value),
        changed,
      });
      if (settings.writeStacks) event.stack = callSite(own, true);
      if (changed) meta.lastChange = event.seq;
    }
  }

  class Computed extends Base.Computed {
    constructor(callback, options) {
      if (typeof callback !== 'function') {
        super(callback, options); // let Base raise its own error
        return;
      }
      super(function inspectedComputation() {
        return run(this, callback);
      }, options);
      track(this, 'computed', options);
    }
  }

  function run(computed, callback) {
    const meta = metaOf(computed) ?? track(computed, 'computed');
    // At the start of a run the sources are still the previous run's: whichever of them changed
    // since that run started is why this one is happening.
    const causes = [];
    if (meta.lastRun >= 0) {
      for (const source of sourcesOf(Base, computed)) {
        const sourceMeta = metaOf(source);
        if (sourceMeta && sourceMeta.lastChange > meta.lastRun && !causes.includes(sourceMeta.id)) {
          causes.push(sourceMeta.id);
        }
      }
    }
    const first = meta.lastRun < 0;
    meta.lastRun = seq;
    const start = now();
    let value;
    try {
      value = callback.call(computed);
    } catch (error) {
      meta.runs++;
      meta.error = preview(error);
      meta.causes = causes;
      const event = record('error', meta, { causes, ms: round(now() - start), error: meta.error });
      meta.lastChange = event.seq;
      meta.lastRun = event.seq - 1;
      throw error;
    }
    meta.runs++;
    let changed = true;
    if (meta.hasValue && !meta.error) {
      try {
        changed = !meta.equals.call(computed, meta.value, value);
      } catch {
        changed = true;
      }
    }
    meta.error = null;
    meta.hasValue = true;
    meta.value = value;
    meta.causes = causes;
    const event = record('run', meta, { causes, first, changed, ms: round(now() - start), to: preview(value) });
    meta.lastRun = event.seq - 1; // changes recorded during this run (by nested computeds) count next time
    if (changed) meta.lastChange = event.seq;
    return value;
  }

  class Watcher extends Base.subtle.Watcher {
    constructor(notify) {
      if (typeof notify !== 'function') {
        super(notify);
        return;
      }
      super(function inspectedNotify(...args) {
        const meta = metaOf(this);
        if (meta) {
          meta.notifies++;
          record('notify', meta, {});
        }
        return notify.apply(this, args);
      });
      track(this, 'watcher');
    }
  }

  const subtle = copy(Base.subtle);
  subtle.Watcher = Watcher;
  const Signal = copy(Base);
  Signal.State = State;
  Signal.Computed = Computed;
  Signal.subtle = Object.freeze(subtle);
  Object.defineProperty(Signal, MARK, { value: { base } });
  Object.freeze(Signal);

  // ---- runtimes with a private copy of the API -----------------------------------------------

  /**
   * A runtime that doesn't take `globalThis.Signal` hands over its implementation and its
   * watchers; their graph is read through `introspectSources`. Returns a handle to add watchers
   * created later and to unregister.
   */
  function register({ name = 'runtime', Signal: impl, watchers = [] } = {}) {
    if (!impl?.subtle?.introspectSources) throw new TypeError('register() needs the runtime\'s Signal');
    const entry = { name: String(name), Signal: impl, watchers: new Set() };
    const add = (watcher) => {
      entry.watchers.add(new WeakRef(watcher));
    };
    for (const watcher of watchers) add(watcher);
    runtimes.push(entry);
    return {
      addWatcher: add,
      dispose() {
        const at = runtimes.indexOf(entry);
        if (at >= 0) runtimes.splice(at, 1);
      },
    };
  }

  function kindIn(impl, signal) {
    if (signal instanceof impl.State) return 'state';
    if (signal instanceof impl.Computed) return 'computed';
    if (signal instanceof impl.subtle.Watcher) return 'watcher';
    return 'signal';
  }

  /** Walk every registered runtime's graph from its watchers, so its signals get ids. */
  function discover() {
    for (const entry of runtimes) {
      const impl = entry.Signal;
      const seen = new Set();
      const stack = [];
      for (const ref of entry.watchers) {
        const watcher = ref.deref();
        if (!watcher) entry.watchers.delete(ref);
        else stack.push(watcher);
      }
      while (stack.length && seen.size < MAX_NODES) {
        const signal = stack.pop();
        if (seen.has(signal)) continue;
        seen.add(signal);
        if (!metaOf(signal)) track(signal, kindIn(impl, signal), undefined, entry.name, impl);
        for (const source of sourcesOf(impl, signal)) stack.push(source);
      }
    }
  }

  // ---- reading -------------------------------------------------------------------------------

  function valueOf(meta, signal) {
    if (meta.kind === 'watcher') return { value: null };
    if (meta.kind === 'computed' && !meta.runtime) {
      if (meta.error) return { value: meta.error, error: true };
      return meta.hasValue ? { value: preview(meta.value) } : { value: null, unread: true };
    }
    // A runtime's computed or any state: read it, untracked (never during a notification:
    // snapshot() is only called from DevTools, between tasks).
    const read = untracked(meta.impl, () => signal.get());
    return read.ok ? { value: preview(read.value) } : { value: preview(read.error), error: true };
  }

  /** Everything DevTools shows, as JSON. `since` is the last event seq the caller has. */
  function snapshot(since = 0) {
    discover();
    const list = [];
    const edges = [];
    for (const meta of nodes.values()) {
      if (list.length >= MAX_NODES) break;
      const signal = meta.ref.deref();
      if (!signal) continue;
      const { value, error, unread } = valueOf(meta, signal);
      const sinks = meta.kind === 'watcher' ? [] : sinksOf(meta.impl, signal);
      list.push({
        id: meta.id,
        kind: meta.kind,
        label: meta.label,
        site: meta.site,
        runtime: meta.runtime,
        value,
        error: !!error,
        unread: !!unread,
        live: meta.kind === 'watcher' ? true : sinks.length > 0,
        sets: meta.sets,
        runs: meta.runs,
        notifies: meta.notifies,
        lastChange: meta.lastChange,
        causes: meta.causes,
      });
      if (meta.kind !== 'state') {
        for (const source of sourcesOf(meta.impl, signal)) {
          const sourceMeta = metaOf(source) ?? track(source, kindIn(meta.impl, source), undefined, meta.runtime, meta.impl);
          if (!edges.some(([from, to]) => from === sourceMeta.id && to === meta.id)) edges.push([sourceMeta.id, meta.id]);
        }
      }
    }
    return {
      version: HOOK_VERSION,
      base,
      provided: globalThis.Signal === Signal,
      seq,
      settings: { writeStacks: settings.writeStacks, ignore: [...settings.ignore] },
      runtimes: runtimes.map((entry) => ({ name: entry.name, watchers: entry.watchers.size })),
      nodes: list,
      edges,
      events: since > 0 ? events.filter((event) => event.seq > since) : events.slice(-500),
      dropped: since > 0 && events.length > 0 && events[0].seq > since + 1,
    };
  }

  function get(id) {
    return nodes.get(id)?.ref.deref();
  }

  const hook = {
    version: HOOK_VERSION,
    Signal,
    register,
    snapshot,
    get,
    /** Give a signal a readable name in DevTools (the proposal has no name option). */
    label(signal, name) {
      const meta = metaOf(signal);
      if (meta) meta.label = String(name);
      return signal;
    },
    /** Write a state from DevTools. `json` is parsed; a non-JSON string is written as is. */
    setValue(id, json) {
      const signal = get(id);
      if (!(signal instanceof (nodes.get(id).impl.State))) throw new Error('Only a State can be written');
      let value = json;
      try {
        value = JSON.parse(json);
      } catch {}
      signal.set(value);
      return true;
    },
    /** Log a signal and its current value to the page's console. */
    log(id) {
      const meta = nodes.get(id);
      const signal = get(id);
      if (!signal) return false;
      const read = meta.kind === 'watcher' ? { ok: true, value: undefined } : untracked(meta.impl, () => signal.get());
      console.log(`[signals] #${id} ${meta.label ?? meta.kind}`, read.ok ? read.value : read.error, signal);
      return true;
    },
    configure(next) {
      if (typeof next?.writeStacks === 'boolean') settings.writeStacks = next.writeStacks;
      return { ...settings };
    },
    /**
     * Look past frames whose URL matches when naming where signals are made: a runtime calls
     * this with its own location so creation sites point at the code that uses it.
     * Patterns are regular expression sources (or plain substrings if they don't parse).
     */
    ignoreFrames(...patterns) {
      for (const pattern of patterns) if (typeof pattern === 'string' && !settings.ignore.includes(pattern)) settings.ignore.push(pattern);
      compileIgnore();
      return [...settings.ignore];
    },
    clearEvents() {
      events.length = 0;
      return seq;
    },
  };

  return { Signal, hook };
}

// ---- helpers ---------------------------------------------------------------------------------

function copy(object) {
  const out = {};
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if ('value' in descriptor) out[key] = descriptor.value;
    else Object.defineProperty(out, key, { ...descriptor, configurable: true });
  }
  return out;
}

const round = (ms) => Math.round(ms * 1000) / 1000;

function labelFrom(options) {
  const name = options?.name ?? options?.label ?? options?.debugName;
  return typeof name === 'string' && name ? name : null;
}

/** Where this file is, so its own frames can be skipped in stacks. */
function ownLocation() {
  const line = (new Error().stack ?? '').split('\n').find((l) => /(\w+:\/\/|\/)[^\s)]+:\d+/.test(l));
  return line?.match(/((?:\w+:\/\/)?[^\s()]+?):\d+:\d+/)?.[1] ?? null;
}

const FRAME = /^\s*(?:at\s+)?(?:(.*?)\s+\()?(?:.*?@)?((?:\w[\w+.-]*:\/\/|\/)[^\s()]+?):(\d+):(\d+)\)?\s*$/;

/**
 * The first stack frame outside this file and outside ignored libraries ({ url, line, column,
 * fn }); if every frame is ignored, the first one outside this file. `several` returns up to six.
 */
function callSite(own, several = false) {
  const frames = [];
  let fallback = null;
  for (const line of (new Error().stack ?? '').split('\n')) {
    const match = line.match(FRAME);
    if (!match) continue;
    const [, fn, url, row, column] = match;
    if (url === own.url) continue;
    const frame = { url, line: Number(row), column: Number(column), fn: fn?.replace(/^(async |new )/, '') || null };
    if (several) {
      frames.push(frame);
      if (frames.length >= 6) break;
      continue;
    }
    fallback ??= frame;
    if (!own.skip(url)) return frame;
  }
  return several ? frames : fallback;
}

/** A short, JSON-safe description of any value. */
export function preview(value, depth = 0) {
  const type = typeof value;
  if (value === null || value === undefined || type === 'boolean' || type === 'number') return String(value);
  if (type === 'bigint') return `${value}n`;
  if (type === 'string') return depth ? JSON.stringify(cut(value, 60)) : JSON.stringify(cut(value, 200));
  if (type === 'symbol') return value.toString();
  if (type === 'function') return `ƒ ${value.name || 'anonymous'}()`;
  if (value instanceof Error) return `${value.name}: ${cut(value.message, 160)}`;
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return value.nodeType === 1 ? `<${value.localName}${value.id ? `#${value.id}` : ''}>` : `#${value.nodeName}`;
  }
  if (value instanceof Date) return `Date(${isNaN(value) ? 'Invalid' : value.toISOString()})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (Array.isArray(value)) {
    if (depth >= 2) return `Array(${value.length})`;
    const items = value.slice(0, 10).map((item) => preview(item, depth + 1));
    return `[${items.join(', ')}${value.length > 10 ? `, …${value.length - 10} more` : ''}]`;
  }
  if (type === 'object') {
    const name = value.constructor && value.constructor !== Object ? value.constructor.name : '';
    if (depth >= 2) return name ? `${name} {…}` : '{…}';
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      return name || 'Object';
    }
    const parts = keys.slice(0, 8).map((key) => {
      let item;
      try {
        item = preview(value[key], depth + 1);
      } catch {
        item = '?';
      }
      return `${key}: ${item}`;
    });
    return `${name ? `${name} ` : ''}{${parts.join(', ')}${keys.length > 8 ? ', …' : ''}}`;
  }
  return String(value);
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);
