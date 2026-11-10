// The Signals panel. It reads the page only through `__SIGNALS_DEVTOOLS_HOOK__` (src/core.js),
// by `inspectedWindow.eval`: plain JSON in and out, no messaging, no background page.
import { Model, nameOf, basename, layout, describeEvent } from './model.js';

// ---- talking to the page -----------------------------------------------------------------

// test/panel harness supplies its own bridge; in DevTools it's inspectedWindow.
const bridge = globalThis.__SIGNALS_PANEL_BRIDGE__ ?? {
  eval(code) {
    return new Promise((resolve) => {
      chrome.devtools.inspectedWindow.eval(code, (result, exception) => {
        resolve(exception ? { error: exception.value ?? exception.description ?? 'The page threw' } : { result });
      });
    });
  },
  onNavigated(fn) {
    chrome.devtools.network.onNavigated.addListener(fn);
  },
  openResource(url, line) {
    chrome.devtools.panels.openResource(url, Math.max(0, line - 1), () => {});
  },
  theme: chrome.devtools?.panels?.themeName,
};

const HOOK = 'globalThis.__SIGNALS_DEVTOOLS_HOOK__';
const call = (method, ...args) => bridge.eval(`${HOOK}?.${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`);

// ---- state -------------------------------------------------------------------------------

const model = new Model();
const ui = {
  view: 'list',
  selected: null,
  filter: '',
  kinds: new Set(['state', 'computed', 'watcher', 'signal']),
  paused: false,
  connected: null, // null: unknown yet, false: no hook on the page
};

const $ = (selector) => document.querySelector(selector);

/** Build an element: h('td', { class: 'v' }, 'text', child). Text is never parsed as HTML. */
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

const KIND_LETTER = { state: 'S', computed: 'C', watcher: 'W', signal: '?' };
const kindBadge = (kind) => h('span', { class: `kind ${kind}`, title: kind }, KIND_LETTER[kind] ?? '?');
const name = (id) => nameOf(model.nodes.get(id));

// ---- polling -----------------------------------------------------------------------------

let timer = null;
async function poll() {
  timer = null;
  if (!ui.paused && document.visibilityState !== 'hidden') {
    const { result, error } = await call('snapshot', model.seq);
    if (error) showStatus(`Couldn't read the page: ${error}`);
    else if (result == null) {
      if (ui.connected !== false) {
        ui.connected = false;
        model.reset();
        renderAll();
      }
    } else {
      const wasConnected = ui.connected;
      ui.connected = true;
      model.update(result);
      if (wasConnected !== true) renderAll();
      else render();
    }
  }
  timer = setTimeout(poll, 500);
}

function refresh() {
  clearTimeout(timer);
  poll();
}

function restart() {
  model.reset();
  ui.selected = null;
  ui.connected = null;
  clearTimeout(timer);
  timer = setTimeout(poll, 300);
  renderAll();
}

// ---- rendering ---------------------------------------------------------------------------

function visibleNodes() {
  const needle = ui.filter.toLowerCase();
  const out = [];
  for (const node of model.nodes.values()) {
    if (!ui.kinds.has(node.kind)) continue;
    if (needle) {
      const hay = `${nameOf(node)} ${node.value ?? ''} ${node.site?.url ?? ''} ${node.runtime ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    out.push(node);
  }
  return out;
}

function renderAll() {
  const empty = $('#empty');
  if (ui.connected === false) {
    empty.hidden = false;
    $('#views').hidden = true;
    $('#detail').hidden = true;
    empty.replaceChildren(
      h('h2', {}, 'No Signals hook on this page'),
      h('p', {}, 'The inspector runs on localhost, *.localhost, 127.0.0.1 and file:// pages. To use it on another site, add the site in the extension\'s options, then reload the page.'),
      h('p', {}, h('button', { onclick: openOptions }, 'Open options')),
      h('p', {}, 'Code that takes the global when there is one is inspected with no changes:'),
      h('pre', {}, 'import { Signal as Polyfill } from "signal-polyfill";\nexport const Signal = globalThis.Signal ?? Polyfill;'),
      h('p', {}, 'A runtime that keeps a private copy can register its watchers instead:'),
      h('pre', {}, 'globalThis.__SIGNALS_DEVTOOLS_HOOK__?.register({\n  name: "my-runtime", Signal, watchers: [watcher],\n});'),
    );
  } else {
    empty.hidden = true;
    $('#views').hidden = false;
    $('#detail').hidden = false;
  }
  render(true);
}

function render(force = false) {
  if (ui.connected !== true && !force) return;
  if (ui.view === 'list') renderList();
  if (ui.view === 'graph') renderGraph();
  if (ui.view === 'timeline') renderTimeline();
  renderDetail();
  renderStatus();
}

function renderList() {
  const rows = visibleNodes().map((node) => {
    const value = node.kind === 'watcher' ? '' : node.unread ? 'not computed yet' : node.value;
    const count = node.kind === 'state' ? node.sets : node.kind === 'watcher' ? node.notifies : node.runs;
    const tr = h(
      'tr',
      { 'aria-selected': String(node.id === ui.selected), 'data-id': node.id, onclick: () => select(node.id) },
      h('td', {}, kindBadge(node.kind)),
      h('td', { title: nameOf(node) }, nameOf(node), node.runtime ? h('span', { class: 'muted' }, `  ${node.runtime}`) : null),
      h('td', { class: `v${node.error ? ' error' : ''}${node.unread ? ' unread' : ''}`, title: value ?? '' }, value ?? ''),
      h('td', { class: 'n' }, count),
      h('td', { class: 'n' }, h('span', { class: `dot${node.live ? ' on' : ''}`, title: node.live ? 'Live: a Watcher depends on it' : 'Not watched' })),
    );
    if (model.changed.has(node.id)) tr.classList.add('flash');
    return tr;
  });
  $('#list tbody').replaceChildren(...rows);
}

function renderTimeline() {
  const name = (id) => nameOf(model.nodes.get(id)) ?? `#${id}`;
  const wanted = new Set(visibleNodes().map((n) => n.id));
  const items = [];
  for (let i = model.events.length - 1; i >= 0 && items.length < 600; i--) {
    const event = model.events[i];
    if (model.nodes.has(event.id) && !wanted.has(event.id)) continue;
    items.push(
      h(
        'li',
        { class: 'event', onclick: () => select(event.id), title: event.stack ? stackText(event.stack) : null },
        h('span', { class: 't' }, `${(event.t / 1000).toFixed(3)}s`),
        h('span', { class: `type ${event.type}` }, event.type),
        h('span', { class: 'who' }, name(event.id)),
        h('span', { class: `what${event.type === 'error' ? ' error-text' : ''}` }, describeEvent(event, name)),
      ),
    );
  }
  if (!items.length) items.push(h('li', { class: 'muted', style: 'padding:8px 10px' }, 'Nothing has happened yet. Writes, runs and notifications appear here as they happen.'));
  $('#timeline ol').replaceChildren(...items);
}

const stackText = (frames) => frames.map((f) => `${f.fn ?? '(anonymous)'} ${f.url}:${f.line}:${f.column}`).join('\n');

const NODE_W = 168;
const NODE_H = 36;
const GAP_X = 70;
const GAP_Y = 12;
const MAX_GRAPH = 400;

function renderGraph() {
  const svg = $('#graph-svg');
  let ids = visibleNodes().map((n) => n.id);
  if (ids.length > MAX_GRAPH && ui.selected != null) {
    const near = new Set([ui.selected, ...model.reach(ui.selected, 'up'), ...model.reach(ui.selected, 'down')]);
    ids = ids.filter((id) => near.has(id));
  }
  if (ids.length > MAX_GRAPH) {
    svg.replaceChildren(s('text', { x: 10, y: 20, fill: 'currentColor' }, `${ids.length} signals: too many to draw. Filter, or select one to draw only what it's connected to.`));
    svg.setAttribute('width', 600);
    svg.setAttribute('height', 40);
    return;
  }
  const positions = layout(ids, model.edges);
  let width = 0;
  let height = 0;
  const at = new Map();
  for (const [id, { column, row }] of positions) {
    const x = column * (NODE_W + GAP_X);
    const y = row * (NODE_H + GAP_Y);
    at.set(id, { x, y });
    width = Math.max(width, x + NODE_W);
    height = Math.max(height, y + NODE_H);
  }
  const up = ui.selected != null ? model.reach(ui.selected, 'up') : null;
  const down = ui.selected != null ? model.reach(ui.selected, 'down') : null;
  const related = (id) => ui.selected == null || id === ui.selected || up.has(id) || down.has(id);

  const edges = [];
  for (const [from, to] of model.edges) {
    const a = at.get(from);
    const b = at.get(to);
    if (!a || !b) continue;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    const cause = model.nodes.get(to)?.causes?.includes(from) && model.changed.has(to);
    const hot = ui.selected != null && related(from) && related(to) && (from === ui.selected || to === ui.selected || (up.has(from) && (up.has(to) || to === ui.selected)) || (down.has(to) && (down.has(from) || from === ui.selected)));
    edges.push(
      s('path', {
        class: `gedge${hot || cause ? ' hot' : ''}${ui.selected != null && !hot ? ' dim' : ''}`,
        d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 6},${y2}`,
        'marker-end': 'url(#arrow)',
      }),
    );
  }
  const nodes = [];
  for (const id of ids) {
    const node = model.nodes.get(id);
    const { x, y } = at.get(id);
    const classes = ['gnode', node.kind];
    if (id === ui.selected) classes.push('selected');
    else if (!related(id)) classes.push('dim');
    if (model.changed.has(id)) classes.push('changed');
    const label = clip(nameOf(node), 24);
    const value = node.kind === 'watcher' ? `${node.notifies} notifications` : node.unread ? '(not computed)' : clip(node.value ?? '', 26);
    nodes.push(
      s(
        'g',
        { class: classes.join(' '), transform: `translate(${x},${y})`, onclick: () => select(id) },
        s('title', {}, `${node.kind}: ${nameOf(node)}\n${node.value ?? ''}`),
        s('rect', { width: NODE_W, height: NODE_H }),
        s('text', { x: 8, y: 15 }, `${KIND_LETTER[node.kind]}  ${label}`),
        s('text', { x: 8, y: 29, class: 'val' }, value),
      ),
    );
  }
  const defs = s(
    'defs',
    {},
    s('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--edge)' })),
  );
  svg.setAttribute('width', width + 4);
  svg.setAttribute('height', height + 4);
  svg.replaceChildren(defs, ...edges, ...nodes);
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function chip(id, cls = '') {
  const node = model.nodes.get(id);
  return h('button', { class: `chip ${cls}`, onclick: () => select(id), title: node?.value ?? '' }, node ? kindBadge(node.kind) : null, h('span', {}, name(id)));
}

let editing = false;
function renderDetail() {
  const pane = $('#detail');
  if (editing) return; // don't replace the input someone is typing in
  const node = model.nodes.get(ui.selected);
  if (!node) {
    pane.replaceChildren(h('p', { class: 'muted' }, ui.selected == null ? 'Select a signal to see its value, what it reads, what reads it, and why it last changed.' : 'That signal was garbage collected.'));
    return;
  }
  const parts = [
    h('h2', {}, kindBadge(node.kind), h('span', {}, nameOf(node)), node.runtime ? h('span', { class: 'badge' }, node.runtime) : null, node.live ? h('span', { class: 'badge' }, 'live') : null),
  ];
  if (node.site) {
    parts.push(
      h('div', { class: 'muted' }, 'Created at ', h('a', { class: 'site mono', onclick: () => bridge.openResource(node.site.url, node.site.line), title: node.site.url }, `${basename(node.site.url)}:${node.site.line}:${node.site.column}`)),
    );
  } else if (node.runtime) {
    parts.push(h('div', { class: 'muted' }, `Read from ${node.runtime} through introspection: writes and runs aren't recorded.`));
  }

  if (node.kind !== 'watcher') {
    parts.push(h('h3', {}, node.error ? 'Error' : 'Value'));
    parts.push(h('pre', { class: `value${node.error ? ' error' : ''}` }, node.unread ? 'Not computed yet: nothing has read it.' : node.value));
    const actions = h('div', { class: 'row' });
    if (node.kind === 'state') {
      const input = h('input', { type: 'text', placeholder: 'New value (JSON)', 'aria-label': 'New value as JSON', onfocus: () => (editing = true), onblur: () => (editing = false) });
      const write = async () => {
        const { result, error } = await call('setValue', node.id, input.value);
        if (error || result !== true) showStatus(`Couldn't write: ${error ?? 'no hook'}`);
        editing = false;
        input.value = '';
        refresh();
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && write());
      actions.append(input, h('button', { onclick: write }, 'Set'));
    }
    actions.append(h('button', { onclick: () => call('log', node.id), title: 'console.log the full value and the signal' }, 'Log'));
    parts.push(actions);
  } else {
    parts.push(h('p', {}, `Notified ${node.notifies} time${node.notifies === 1 ? '' : 's'}.`));
    parts.push(h('div', { class: 'row' }, h('button', { onclick: () => call('log', node.id) }, 'Log')));
  }

  if (node.kind === 'computed' && !node.runtime) {
    parts.push(h('h3', {}, 'Last run'));
    if (node.runs === 0) parts.push(h('p', { class: 'muted' }, 'Hasn\'t run yet.'));
    else if (node.causes.length) parts.push(h('p', {}, 'Re-ran because these changed: '), h('div', { class: 'chips' }, node.causes.map((id) => chip(id, 'cause'))));
    else parts.push(h('p', { class: 'muted' }, node.runs === 1 ? 'Its first run.' : 'No recorded source changed (a source from outside the inspector, or its first read).'));
  }

  const sources = model.sources.get(node.id) ?? [];
  const sinks = model.sinks.get(node.id) ?? [];
  if (node.kind !== 'state') {
    parts.push(h('h3', {}, node.kind === 'watcher' ? `Watches (${sources.length})` : `Reads (${sources.length})`));
    parts.push(sources.length ? h('div', { class: 'chips' }, sources.map((id) => chip(id))) : h('p', { class: 'muted' }, 'Nothing.'));
  }
  if (node.kind !== 'watcher') {
    parts.push(h('h3', {}, `Read by (${sinks.length})`));
    parts.push(
      sinks.length
        ? h('div', { class: 'chips' }, sinks.map((id) => chip(id)))
        : h('p', { class: 'muted' }, 'Nothing live. (Only watched readers are tracked back: an unwatched Computed reading this won\'t show here.)'),
    );
  }

  const recent = model.events.filter((e) => e.id === node.id).slice(-15).reverse();
  parts.push(h('h3', {}, 'Recent'));
  parts.push(
    recent.length
      ? h('ol', { class: 'recent', style: 'padding:0;margin:0;list-style:none' }, recent.map((e) => h('li', { class: 'event', style: 'grid-template-columns:62px 46px 1fr', title: e.stack ? stackText(e.stack) : null }, h('span', { class: 't' }, `${(e.t / 1000).toFixed(3)}s`), h('span', { class: `type ${e.type}` }, e.type), h('span', { class: 'what' }, describeEvent(e, name)))))
      : h('p', { class: 'muted' }, 'Nothing recorded.'),
  );
  pane.replaceChildren(...parts);
}

function renderStatus() {
  if (ui.connected === false) return showStatus('No hook on this page.');
  const info = model.info;
  if (!info) return showStatus('Connecting…');
  const counts = { state: 0, computed: 0, watcher: 0 };
  for (const node of model.nodes.values()) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  const where = info.provided ? `Signal provided on this page (instrumented ${info.base})` : 'The page replaced globalThis.Signal: only registered runtimes are visible';
  const rts = info.runtimes.length ? ` · registered: ${info.runtimes.map((r) => r.name).join(', ')}` : '';
  showStatus(`${counts.state} states · ${counts.computed} computeds · ${counts.watcher} watchers · ${model.events.length} events${ui.paused ? ' · paused' : ''} — ${where}${rts}`);
}

function showStatus(text) {
  $('#status').textContent = text;
}

// ---- interaction -------------------------------------------------------------------------

function select(id) {
  ui.selected = id;
  editing = false;
  render(true);
  const row = document.querySelector(`#list tr[data-id="${id}"]`);
  row?.scrollIntoView({ block: 'nearest' });
}

function openOptions() {
  try {
    chrome.runtime.openOptionsPage();
  } catch {
    showStatus('Open the extension\'s options from the browser\'s extensions page.');
  }
}

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => {
    ui.view = tab.dataset.view;
    for (const other of document.querySelectorAll('.tabs button')) other.setAttribute('aria-selected', String(other === tab));
    for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== ui.view;
    render(true);
  });
}
$('#filter').addEventListener('input', (e) => {
  ui.filter = e.target.value;
  render(true);
});
for (const box of document.querySelectorAll('[data-kind]')) {
  box.addEventListener('change', () => {
    if (box.checked) ui.kinds.add(box.dataset.kind);
    else ui.kinds.delete(box.dataset.kind);
    render(true);
  });
}
$('#pause').addEventListener('click', (e) => {
  ui.paused = !ui.paused;
  e.target.textContent = ui.paused ? 'Resume' : 'Pause';
  e.target.setAttribute('aria-pressed', String(ui.paused));
  renderStatus();
});
$('#clear').addEventListener('click', async () => {
  await call('clearEvents');
  model.events.length = 0;
  render(true);
});
$('#stacks').addEventListener('change', (e) => call('configure', { writeStacks: e.target.checked }));
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || ui.selected == null) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const ids = visibleNodes().map((n) => n.id);
  const at = ids.indexOf(ui.selected);
  const next = ids[at + (e.key === 'ArrowDown' ? 1 : -1)];
  if (next != null) {
    e.preventDefault();
    select(next);
  }
});
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

if (bridge.theme === 'dark') document.documentElement.dataset.theme = 'dark';
bridge.onNavigated?.(restart);
restart();
