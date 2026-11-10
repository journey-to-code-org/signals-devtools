// Signals Playground: run code against the TC39 Signals API and watch its graph.
// Each run gets a fresh inspector (src/core.js) over the reference polyfill; the views read it
// through the same snapshot() the DevTools panel uses.
import { Signal as Polyfill } from 'signal-polyfill';
import { createInspector, preview } from '../src/core.js';
import { Model, layout, describeEvent } from '../extension/model.js';
import { EXAMPLES } from './examples.js';

const CODE_URL = '/your-code.js';
const $ = (selector) => document.querySelector(selector);

// How many lines `new Function` puts before the body, so stack lines map to the editor's.
const LINE_OFFSET = (() => {
  try {
    // Same shape as compile(): "use strict" on its own line, then the user's first line.
    new Function('a', `"use strict";\nthrow new Error('probe')\n//# sourceURL=/probe.js`)();
  } catch (error) {
    const match = String(error.stack).match(/\/probe\.js:(\d+)/);
    if (match) return Number(match[1]) - 1;
  }
  return 2;
})();

const lineIn = (stack) => {
  const match = String(stack ?? '').match(/\/your-code\.js:(\d+)(?::(\d+))?/);
  return match ? Number(match[1]) - LINE_OFFSET : null;
};

// ---- DOM helpers ---------------------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) el.append(child instanceof Node ? child : String(child));
  return el;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---- editor --------------------------------------------------------------------------------

const textarea = $('#source');
let cm = null;
if (globalThis.CodeMirror) {
  cm = CodeMirror.fromTextArea(textarea, {
    mode: 'javascript',
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: false,
    extraKeys: {
      'Ctrl-Enter': () => run({ explicit: true }),
      'Cmd-Enter': () => run({ explicit: true }),
      Tab: (editor) => editor.replaceSelection('  '),
    },
  });
} else {
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run({ explicit: true });
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const { selectionStart: start, selectionEnd: end, value } = textarea;
      textarea.value = `${value.slice(0, start)}  ${value.slice(end)}`;
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      onEdit();
    }
  });
  textarea.addEventListener('input', () => onEdit());
}
const editor = {
  get: () => (cm ? cm.getValue() : textarea.value),
  set(code) {
    if (cm) cm.setValue(code);
    else textarea.value = code;
  },
  markError(line) {
    if (!cm) return;
    for (let i = 0; i < cm.lineCount(); i++) cm.removeLineClass(i, 'background', 'error-line');
    if (line != null && line >= 1 && line <= cm.lineCount()) cm.addLineClass(line - 1, 'background', 'error-line');
  },
};
cm?.on('change', (_, change) => change.origin !== 'setValue' && onEdit());

// ---- console -------------------------------------------------------------------------------

const consoleList = $('#console');
function print(kind, parts, line = null) {
  const text = parts.map((part) => (typeof part === 'string' ? part : preview(part))).join(' ');
  const item = h('li', { class: kind }, h('span', {}, text), line ? h('span', { class: 'at' }, `line ${line}`) : null);
  consoleList.append(item);
  while (consoleList.children.length > 300) consoleList.firstElementChild.remove();
  consoleList.scrollTop = consoleList.scrollHeight;
}
$('#clear-console').addEventListener('click', () => consoleList.replaceChildren());

// ---- running code --------------------------------------------------------------------------

let session = null;
let runCount = 0;

function compile(code) {
  return new Function('Signal', 'effect', 'log', 'ui', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', `"use strict";\n${code}\n//# sourceURL=${CODE_URL}`);
}

function createSession() {
  // With the Signals Inspector extension on this page, build on its instrumented Signal, so its
  // DevTools panel sees what the playground does too (and looks past the playground's own code).
  const pageHook = globalThis.__SIGNALS_DEVTOOLS_HOOK__;
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  pageHook?.ignoreFrames?.(`^${escape(location.origin + location.pathname)}`);
  const { Signal, hook } = createInspector(pageHook?.Signal ?? Polyfill, { base: pageHook ? 'extension' : 'polyfill' });
  const label = (signal, name) => {
    pageHook?.label?.(signal, name);
    return hook.label(signal, name);
  };
  const timers = new Set();
  const stage = $('#stage');
  stage.replaceChildren();
  let disposed = false;

  const reportError = (error) => {
    const line = lineIn(error?.stack);
    print('error', [error instanceof Error ? `${error.name}: ${error.message}` : `Thrown: ${preview(error)}`], line);
    editor.markError(line);
  };

  // effect(): one Watcher, re-reading what went dirty once per microtask.
  let queued = false;
  const watcher = label(
    new Signal.subtle.Watcher(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    }),
    'effects',
  );
  function flush() {
    queued = false;
    if (disposed) return;
    for (const signal of watcher.getPending()) {
      try {
        signal.get();
      } catch (error) {
        reportError(error);
      }
    }
    watcher.watch();
  }
  function effect(fn, name) {
    if (typeof fn !== 'function') throw new TypeError('effect() takes a function');
    let cleanup;
    const computed = new Signal.Computed(() => {
      if (typeof cleanup === 'function') cleanup();
      cleanup = fn();
    });
    if (name) label(computed, name);
    watcher.watch(computed);
    try {
      computed.get();
    } catch (error) {
      reportError(error);
    }
    return () => {
      watcher.unwatch(computed);
      if (typeof cleanup === 'function') cleanup();
    };
  }

  const log = (...values) => print('log', values, lineIn(new Error().stack));

  const guard = (fn) => (...args) => {
    if (disposed) return undefined;
    try {
      return fn(...args);
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };
  const checkState = (state, helper) => {
    if (!(state instanceof Signal.State)) throw new TypeError(`ui.${helper}() needs a Signal.State`);
  };
  const add = (el) => {
    stage.append(el);
    return el;
  };
  const ui = {
    button(label, fn) {
      add(h('button', { type: 'button', onclick: guard(fn) }, String(label)));
    },
    slider(label, state, { min = 0, max = 100, step = 1 } = {}) {
      checkState(state, 'slider');
      const id = `ctl-${stage.children.length}`;
      const input = h('input', { type: 'range', id, min, max, step, oninput: guard((e) => state.set(Number(e.target.value))) });
      const out = h('span', { class: 'out' });
      add(h('label', { class: 'ctl', for: id }, h('span', { class: 'name' }, String(label)), input, out));
      effect(() => {
        const value = state.get();
        input.value = value;
        out.textContent = String(value);
      }, `ui: ${label}`);
    },
    text(label, state) {
      checkState(state, 'text');
      const id = `ctl-${stage.children.length}`;
      const input = h('input', { type: 'text', id, oninput: guard((e) => state.set(e.target.value)) });
      add(h('label', { class: 'ctl', for: id }, h('span', { class: 'name' }, String(label)), input));
      effect(() => {
        const value = String(state.get() ?? '');
        if (input.value !== value) input.value = value;
      }, `ui: ${label}`);
    },
    toggle(label, state) {
      checkState(state, 'toggle');
      const id = `ctl-${stage.children.length}`;
      const input = h('input', { type: 'checkbox', id, onchange: guard((e) => state.set(e.target.checked)) });
      add(h('label', { class: 'ctl', for: id }, input, h('span', {}, String(label))));
      effect(() => {
        input.checked = !!state.get();
      }, `ui: ${label}`);
    },
    show(label, signal) {
      const out = h('span', { class: 'out' });
      add(h('span', { class: 'ctl' }, h('span', { class: 'name' }, String(label)), out));
      effect(() => {
        try {
          out.textContent = preview(typeof signal === 'function' ? signal() : signal.get());
          out.classList.remove('err');
        } catch (error) {
          out.textContent = String(error?.message ?? error);
          out.classList.add('err');
        }
      }, `ui: ${label}`);
    },
  };

  const timer = (kind) => (fn, ms, ...args) => {
    const set = kind === 'interval' ? globalThis.setInterval : globalThis.setTimeout;
    const id = set(guard(typeof fn === 'function' ? fn : () => {}), ms, ...args);
    timers.add({ kind, id });
    return id;
  };
  const clear = (id) => {
    for (const t of timers) {
      if (t.id === id) {
        (t.kind === 'interval' ? globalThis.clearInterval : globalThis.clearTimeout)(id);
        timers.delete(t);
      }
    }
  };

  return {
    Signal,
    hook,
    args: [Signal, effect, log, ui, timer('timeout'), timer('interval'), clear, clear],
    reportError,
    dispose() {
      disposed = true;
      for (const t of timers) (t.kind === 'interval' ? globalThis.clearInterval : globalThis.clearTimeout)(t.id);
      timers.clear();
      try {
        watcher.unwatch(...Signal.subtle.introspectSources(watcher));
      } catch {}
    },
  };
}

function run({ explicit = false } = {}) {
  const code = editor.get();
  let fn;
  try {
    fn = compile(code);
  } catch (error) {
    // Mid-typing syntax errors keep the last good run on screen.
    showStatus(`Not run: ${error.message}`, true);
    if (explicit) print('error', [`${error.name}: ${error.message}`]);
    return;
  }
  session?.dispose();
  consoleList.replaceChildren();
  editor.markError(null);
  session = createSession();
  model.reset();
  ui.selected = null;
  pulses.clear();
  nodeEls.clear();
  $('#graph-svg').replaceChildren();
  runCount++;
  saveDraft(code);
  try {
    fn(...session.args);
  } catch (error) {
    session.reportError(error);
  }
  refresh(true);
}

// Errors thrown later (timers, promises) from the user's code.
addEventListener('error', (event) => {
  if (lineIn(event.error?.stack) != null) session?.reportError(event.error);
});
addEventListener('unhandledrejection', (event) => {
  if (lineIn(event.reason?.stack) != null) session?.reportError(event.reason);
});

let editTimer = null;
function onEdit() {
  clearTimeout(editTimer);
  if ($('#autorun').checked) editTimer = setTimeout(() => run(), 700);
  else saveDraft(editor.get());
}
$('#run').addEventListener('click', () => run({ explicit: true }));

// ---- reading the graph ---------------------------------------------------------------------

const model = new Model();
const ui = { view: 'graph', selected: null };

function nameOf(node) {
  if (!node) return '(gone)';
  if (node.label) return node.label;
  if (node.site?.url === CODE_URL) return `line ${node.site.line}`;
  return `${node.kind} #${node.id}`;
}
const nameById = (id) => nameOf(model.nodes.get(id));

function refresh(force = false) {
  if (!session) return;
  const snap = session.hook.snapshot(model.seq);
  for (const node of snap.nodes) if (node.site?.url === CODE_URL) node.site = { ...node.site, line: node.site.line - LINE_OFFSET };
  const fresh = snap.events;
  const grew = snap.nodes.length !== model.nodes.size;
  model.update(snap, 1500);
  if (!force && !fresh.length && !grew) return;
  render();
  animate(fresh);
}
setInterval(() => document.visibilityState === 'visible' && refresh(), 120);

// ---- graph ---------------------------------------------------------------------------------

const NODE_W = 144;
const NODE_H = 46;
const GAP_X = 50;
const GAP_Y = 16;
const nodeEls = new Map(); // id → <g>
const positions = new Map(); // id → { x, y }

let vertical = false; // the graph flows top to bottom when that fits the view better

function edgePath(from, to) {
  const a = positions.get(from);
  const b = positions.get(to);
  if (!a || !b) return null;
  if (vertical) {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y - 5;
    const mid = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
  }
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x - 5;
  const y2 = b.y + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

function shapeFor(kind) {
  if (kind === 'state') return s('rect', { class: 'shape', width: NODE_W, height: NODE_H, rx: 2 });
  if (kind === 'watcher') {
    const t = NODE_W - 14;
    return s('polygon', { class: 'shape', points: `0,0 ${t},0 ${NODE_W},${NODE_H / 2} ${t},${NODE_H} 0,${NODE_H}` });
  }
  return s('rect', { class: 'shape', width: NODE_W, height: NODE_H, rx: NODE_H / 2 });
}

/** A Computed that returns nothing and only Watchers read: an effect, for display. */
const isEffect = (node) =>
  node.kind === 'computed' && node.value === 'undefined' && (model.sinks.get(node.id) ?? []).every((id) => model.nodes.get(id)?.kind === 'watcher') && node.live;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function renderGraph() {
  const svg = $('#graph-svg');
  const showHelpers = $('#helpers').checked;
  const helper = (id) => !showHelpers && model.nodes.get(id)?.label?.startsWith('ui: ');
  // Hidden helpers take a Watcher that only watches them along with them.
  const ids = [...model.nodes.keys()].filter((id) => {
    if (helper(id)) return false;
    if (model.nodes.get(id).kind !== 'watcher' || showHelpers) return true;
    const sources = model.sources.get(id) ?? [];
    return !sources.length || sources.some((source) => !helper(source));
  });
  if (!ids.length) {
    svg.replaceChildren(s('text', { class: 'graph-empty', x: 0, y: 16 }, 'Run some code to see its signals here.'));
    svg.setAttribute('width', 320);
    svg.setAttribute('height', 30);
    return;
  }
  const placed = layout(ids, model.edges);
  let columns = 0;
  let rows = 0;
  for (const { column, row } of placed.values()) {
    columns = Math.max(columns, column + 1);
    rows = Math.max(rows, row + 1);
  }
  // Fit the drawing to the view, flowing left to right or top to bottom, whichever shows it
  // larger; down to about half size, past that it scrolls.
  const view = $('#graph');
  const availW = Math.max(200, view.clientWidth - 36);
  const availH = Math.max(160, view.clientHeight - 36);
  const GAP_DOWN = 40;
  const GAP_ACROSS = 20;
  const sideways = { w: columns * (NODE_W + GAP_X) - GAP_X + 8, h: rows * (NODE_H + GAP_Y) - GAP_Y + 8 };
  const stacked = { w: rows * (NODE_W + GAP_ACROSS) - GAP_ACROSS + 8, h: columns * (NODE_H + GAP_DOWN) - GAP_DOWN + 8 };
  const fit = (box) => Math.min(1, availW / box.w, availH / box.h);
  const nextVertical = fit(stacked) > fit(sideways) + 0.05;
  if (nextVertical !== vertical) {
    vertical = nextVertical;
    svg.replaceChildren(); // nodes slide in from the new direction rather than across it
  }
  const box = vertical ? stacked : sideways;
  positions.clear();
  for (const [id, { column, row }] of placed) {
    positions.set(id, vertical ? { x: row * (NODE_W + GAP_ACROSS), y: column * (NODE_H + GAP_DOWN) } : { x: column * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) });
  }
  const width = box.w - 8;
  const height = box.h - 8;
  const scale = Math.max(0.5, fit(box));
  svg.setAttribute('width', Math.round((width + 8) * scale));
  svg.setAttribute('height', Math.round((height + 8) * scale));
  svg.setAttribute('viewBox', `-2 -2 ${width + 8} ${height + 8}`);

  let edgeLayer = svg.querySelector('.edges');
  let nodeLayer = svg.querySelector('.nodes');
  let pulseLayer = svg.querySelector('.pulses');
  if (!edgeLayer) {
    nodeEls.clear();
    svg.replaceChildren(
      s('defs', {}, s('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,1 L10,5 L0,9 z', fill: 'var(--muted)' }))),
      (edgeLayer = s('g', { class: 'edges' })),
      (nodeLayer = s('g', { class: 'nodes' })),
      (pulseLayer = s('g', { class: 'pulses' })),
    );
  }

  const selected = ui.selected;
  const up = selected != null ? model.reach(selected, 'up') : null;
  const down = selected != null ? model.reach(selected, 'down') : null;
  const related = (id) => selected == null || id === selected || up.has(id) || down.has(id);

  const edges = [];
  for (const [from, to] of model.edges) {
    const d = positions.has(from) && positions.has(to) ? edgePath(from, to) : null;
    if (!d) continue;
    const onPath = selected != null && related(from) && related(to) && ((from === selected || up.has(from)) && (to === selected || up.has(to)) || (from === selected || down.has(from)) && (to === selected || down.has(to)));
    edges.push(s('path', { class: `gedge${onPath ? ' hot' : ''}${selected != null && !onPath ? ' dim' : ''}`, d, 'data-edge': `${from}-${to}`, 'marker-end': 'url(#arrow)' }));
  }
  edgeLayer.replaceChildren(...edges);

  for (const [id, el] of nodeEls) {
    if (!positions.has(id)) {
      el.remove();
      nodeEls.delete(id);
    }
  }
  for (const id of ids) {
    const node = model.nodes.get(id);
    const { x, y } = positions.get(id);
    let el = nodeEls.get(id);
    if (!el) {
      el = s(
        'g',
        { class: 'gnode', tabindex: 0, role: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => select(id), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(id)) },
        s('title', {}),
        shapeFor(node.kind),
        s('text', { class: 'title', x: 14, y: 19 }),
        s('text', { class: 'val', x: 14, y: 35 }),
        s('text', { class: 'count', x: node.kind === 'watcher' ? NODE_W - 22 : NODE_W - 12, y: 19 }),
      );
      el.style.transform = `translate(${x}px, ${y}px)`;
      nodeEls.set(id, el);
      nodeLayer.append(el);
    }
    el.style.transform = `translate(${x}px, ${y}px)`;
    const classes = ['gnode', node.kind];
    if (!node.live) classes.push('idle');
    if (node.error) classes.push('errored');
    if (node.unread) classes.push('unread');
    if (id === selected) classes.push('selected');
    else if (!related(id)) classes.push('dim');
    for (const keep of ['hit', 'same']) if (el.classList.contains(keep)) classes.push(keep);
    el.setAttribute('class', classes.join(' '));
    const name = nameOf(node);
    const value = node.kind === 'watcher' ? `watching ${(model.sources.get(id) ?? []).length}` : node.unread ? 'not computed yet' : isEffect(node) ? 'effect' : node.value ?? '';
    const count = node.kind === 'state' ? node.sets : node.kind === 'watcher' ? node.notifies : node.runs;
    const [title, label, val, counter] = [el.children[0], el.children[2], el.children[3], el.children[4]];
    title.textContent = `${node.kind}: ${name}\n${value}`;
    label.textContent = clip(name, node.kind === 'watcher' ? 13 : 16);
    val.textContent = clip(value, 19);
    counter.textContent = count ? `×${count}` : '';
    el.setAttribute('aria-label', `${node.kind} ${name}, ${value}`);
  }
  pulseLayer.parentNode.append(pulseLayer); // keep pulses on top
}

// ---- motion --------------------------------------------------------------------------------

const pulses = {
  timers: new Set(),
  clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    document.querySelectorAll('.pulses > *').forEach((el) => el.remove());
  },
  later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  },
};

function flashNode(id, cls, ms = 520) {
  const el = nodeEls.get(id);
  if (!el) return;
  el.classList.remove('hit', 'same');
  void el.getBoundingClientRect();
  el.classList.add(cls);
  pulses.later(ms, () => el.classList.remove(cls));
}

function ring(id) {
  const at = positions.get(id);
  const layer = document.querySelector('.pulses');
  if (!at || !layer) return;
  const circle = s('rect', { class: 'ring', x: at.x - 3, y: at.y - 3, width: NODE_W + 6, height: NODE_H + 6, rx: model.nodes.get(id)?.kind === 'computed' ? NODE_H / 2 + 3 : 4 });
  layer.append(circle);
  circle.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' }).finished.then(() => circle.remove(), () => circle.remove());
}

function travel(from, to, duration = 420) {
  const edge = document.querySelector(`.gedge[data-edge="${from}-${to}"]`);
  const layer = document.querySelector('.pulses');
  if (!edge || !layer) return;
  edge.classList.add('cause');
  pulses.later(duration + 500, () => edge.classList.remove('cause'));
  const length = edge.getTotalLength();
  const dot = s('circle', { class: 'pulse', r: 4.5 });
  layer.append(dot);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const point = edge.getPointAtLength(eased * length);
    dot.setAttribute('cx', point.x);
    dot.setAttribute('cy', point.y);
    if (t < 1) requestAnimationFrame(step);
    else dot.remove();
  };
  requestAnimationFrame(step);
}

/** Replay a batch of events: writes ring, causes travel along their edges, in order. */
function animate(events) {
  if (ui.view !== 'graph' || !events.length) return;
  const steps = events.filter((e) => e.type === 'set' || e.type === 'notify' || (e.type === 'run' && !e.first) || e.type === 'error').slice(-24);
  const quick = reducedMotion.matches;
  let delay = 0;
  for (const event of steps) {
    const at = delay;
    if (event.type === 'set') {
      pulses.later(at, () => {
        flashNode(event.id, event.changed ? 'hit' : 'same');
        if (event.changed && !quick) ring(event.id);
      });
      delay += quick ? 0 : 140;
    } else if (event.type === 'run' || event.type === 'error') {
      const causes = event.causes ?? [];
      pulses.later(at, () => {
        if (!quick) for (const cause of causes) travel(cause, event.id);
      });
      pulses.later(at + (quick || !causes.length ? 0 : 400), () => flashNode(event.id, event.changed === false ? 'same' : 'hit'));
      delay += quick ? 0 : causes.length ? 300 : 80;
    } else if (event.type === 'notify') {
      pulses.later(at, () => flashNode(event.id, 'hit'));
    }
  }
}

// ---- table, timeline, detail ---------------------------------------------------------------

const KIND_LETTER = { state: 'S', computed: 'C', watcher: 'W', signal: '?' };
const kindBadge = (kind) => h('span', { class: `kind ${kind}`, title: kind }, KIND_LETTER[kind] ?? '?');

function renderTable() {
  const rows = [...model.nodes.values()].map((node) => {
    const value = node.kind === 'watcher' ? '' : node.unread ? 'not computed yet' : node.value;
    const count = node.kind === 'state' ? node.sets : node.kind === 'watcher' ? node.notifies : node.runs;
    return h(
      'tr',
      { 'aria-selected': String(node.id === ui.selected), onclick: () => select(node.id) },
      h('td', {}, kindBadge(node.kind)),
      h('td', { title: nameOf(node) }, nameOf(node)),
      h('td', { class: `v${node.error ? ' err' : ''}`, title: value ?? '' }, value ?? ''),
      h('td', { class: 'n' }, count),
    );
  });
  $('#table tbody').replaceChildren(...rows);
}

function renderTimeline() {
  const items = [];
  for (let i = model.events.length - 1; i >= 0 && items.length < 400; i--) {
    const event = model.events[i];
    items.push(
      h(
        'li',
        { onclick: () => select(event.id) },
        h('span', { class: 't' }, `${(event.t / 1000).toFixed(2)}s`),
        h('span', { class: `type ${event.type}` }, event.type),
        h('span', { class: 'who' }, nameById(event.id)),
        h('span', { class: `what${event.type === 'error' ? ' err' : ''}` }, describeEvent(event, nameById)),
      ),
    );
  }
  if (!items.length) items.push(h('li', { class: 'empty' }, 'Writes, runs and notifications appear here as they happen.'));
  $('#timeline .events').replaceChildren(...items);
}

function chip(id, cls = '') {
  const node = model.nodes.get(id);
  return h('button', { type: 'button', class: `chip ${cls}`, onclick: () => select(id), title: node?.value ?? '' }, node ? kindBadge(node.kind) : null, nameById(id));
}

let typing = false;
function renderDetail() {
  const pane = $('#detail');
  if (typing) return;
  const node = model.nodes.get(ui.selected);
  if (!node) {
    pane.replaceChildren();
    return;
  }
  const sources = model.sources.get(node.id) ?? [];
  const sinks = model.sinks.get(node.id) ?? [];
  const head = h(
    'div',
    { class: 'detail-head' },
    kindBadge(node.kind),
    h('h3', {}, nameOf(node)),
    node.site?.url === CODE_URL ? h('span', { class: 'pill' }, `line ${node.site.line}`) : null,
    h('span', { class: 'pill' }, node.live ? 'watched' : 'not watched'),
    h('button', { type: 'button', class: 'mini close', onclick: () => select(null), 'aria-label': 'Close details' }, 'Close'),
  );

  const left = h('div', {});
  if (node.kind !== 'watcher') {
    left.append(h('h4', {}, node.error ? 'Error' : 'Value'), h('pre', { class: `value${node.error ? ' err' : ''}` }, node.unread ? 'Not computed yet: nothing has read it.' : node.value));
    if (node.kind === 'state') {
      const input = h('input', { type: 'text', id: 'set-value', placeholder: 'New value as JSON', 'aria-label': 'New value as JSON', onfocus: () => (typing = true), onblur: () => (typing = false) });
      const write = () => {
        try {
          session.hook.setValue(node.id, input.value);
        } catch (error) {
          print('error', [error.message]);
        }
        typing = false;
        input.value = '';
        refresh(true);
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && write());
      left.append(h('div', { class: 'row' }, input, h('button', { type: 'button', onclick: write }, 'Set')));
    }
  } else {
    left.append(h('h4', {}, 'Notified'), h('p', { class: 'why' }, `${node.notifies} time${node.notifies === 1 ? '' : 's'}. A Watcher is told something it watches went dirty; it decides when to re-read.`));
  }
  if (node.kind === 'computed') {
    left.append(h('h4', { style: 'margin-top:10px' }, 'Last run'));
    if (node.runs === 0) left.append(h('p', { class: 'why muted' }, 'Hasn\'t run: Computeds are lazy.'));
    else if (node.causes.length) left.append(h('p', { class: 'why' }, 'Re-ran because these changed:'), h('div', { class: 'chips' }, node.causes.map((id) => chip(id, 'cause'))));
    else left.append(h('p', { class: 'why muted' }, node.runs === 1 ? 'Its first run.' : 'No source changed since its previous run.'));
  }

  const right = h('div', {});
  if (node.kind !== 'state') right.append(h('h4', {}, node.kind === 'watcher' ? `Watches ${sources.length}` : `Reads ${sources.length}`), sources.length ? h('div', { class: 'chips' }, sources.map((id) => chip(id))) : h('p', { class: 'why muted' }, 'Nothing.'));
  if (node.kind !== 'watcher') right.append(h('h4', { style: node.kind === 'state' ? null : 'margin-top:10px' }, `Read by ${sinks.length}`), sinks.length ? h('div', { class: 'chips' }, sinks.map((id) => chip(id))) : h('p', { class: 'why muted' }, 'Nothing watched reads it. Unwatched readers aren\'t tracked back to their sources.'));

  pane.replaceChildren(head, h('div', { class: 'grid' }, left, right));
}

function render() {
  if (ui.view === 'graph') renderGraph();
  if (ui.view === 'table') renderTable();
  if (ui.view === 'timeline') renderTimeline();
  renderDetail();
  const counts = { state: 0, computed: 0, watcher: 0 };
  for (const node of model.nodes.values()) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  const writes = model.events.filter((e) => e.type === 'set').length;
  showStatus(`${counts.state} state · ${counts.computed} computed · ${counts.watcher} watcher · ${writes} write${writes === 1 ? '' : 's'} since run ${runCount}`);
}

let toastUntil = 0;
function showStatus(text, important = false) {
  if (!important && performance.now() < toastUntil) return;
  const status = $('#status');
  status.textContent = text;
  status.classList.toggle('toast', important);
  if (important) toastUntil = performance.now() + 3000;
}

function select(id) {
  ui.selected = id;
  typing = false;
  render();
}

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => {
    ui.view = tab.dataset.view;
    for (const other of document.querySelectorAll('[role="tab"]')) other.setAttribute('aria-selected', String(other === tab));
    for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== ui.view;
    if (ui.view === 'graph') $('#graph-svg').replaceChildren(), nodeEls.clear();
    render();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.selected != null && !(e.target instanceof HTMLInputElement)) select(null);
});

// ---- examples, drafts, sharing -------------------------------------------------------------

const select$ = $('#example');
select$.append(...EXAMPLES.map((example) => h('option', { value: example.id }, example.title)), h('option', { value: 'custom', hidden: true }, 'Your code'));
select$.addEventListener('change', () => {
  const example = EXAMPLES.find((e) => e.id === select$.value);
  if (!example) return;
  editor.set(example.code);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  run({ explicit: true });
});

const DRAFT_KEY = 'signals-playground:draft';
function saveDraft(code) {
  const example = EXAMPLES.find((e) => e.code === code);
  select$.value = example ? example.id : 'custom';
  try {
    if (example) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, code);
  } catch {}
}

// Links carry the code compressed and hex-encoded, so the hash is plain letters and digits.
async function encode(code) {
  const stream = new Blob([code]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return `c${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
async function decode(hash) {
  const hex = hash.replace(/^#/, '');
  if (!/^c(?:[0-9a-f]{2})+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.slice(1).match(/../g).map((pair) => parseInt(pair, 16)));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

$('#share').addEventListener('click', async () => {
  const code = editor.get();
  let hash;
  try {
    hash = await encode(code);
  } catch {
    showStatus('This browser can\'t compress the code for a link.', true);
    return;
  }
  location.hash = hash;
  const inFrame = window.top !== window.self;
  if (!inFrame) {
    try {
      await navigator.clipboard.writeText(location.href);
      showStatus('Link copied. It opens with this code.', true);
      return;
    } catch {}
  }
  showStatus(inFrame ? 'Link updated with your code. Copy it from Share or the address bar.' : 'Link updated with your code: copy it from the address bar.', true);
});

async function loadFromHash() {
  if (!location.hash) return false;
  try {
    const code = await decode(location.hash);
    if (code == null) return false;
    if (code !== editor.get()) {
      editor.set(code);
      run({ explicit: true });
    }
    return true;
  } catch {
    showStatus('That link\'s code couldn\'t be read.', true);
    return false;
  }
}
addEventListener('hashchange', loadFromHash);

(async function start() {
  if (await loadFromHash()) return;
  let draft = null;
  try {
    draft = localStorage.getItem(DRAFT_KEY);
  } catch {}
  editor.set(draft || EXAMPLES[0].code);
  run({ explicit: true });
})();

reducedMotion.addEventListener?.('change', () => pulses.clear());
let resizeTimer = null;
$('#helpers').addEventListener('change', () => ui.view === 'graph' && renderGraph());
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => ui.view === 'graph' && renderGraph(), 150);
});
