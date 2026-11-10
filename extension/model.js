// The panel's pure parts: naming nodes, keeping the event log, and laying out the graph.
// No DOM and no extension APIs, so test/model.test.js runs them in Node.

export function basename(url) {
  if (!url) return '';
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

/** What a node is called: its label, else where it was created, else its id. */
export function nameOf(node) {
  if (!node) return '(gone)';
  if (node.label) return node.label;
  if (node.site) return `${node.site.fn ? `${node.site.fn} ` : ''}${basename(node.site.url)}:${node.site.line}`;
  return `${node.kind} #${node.id}`;
}

export class Model {
  constructor() {
    this.reset();
  }

  reset() {
    this.seq = 0;
    this.nodes = new Map();
    this.edges = [];
    this.sources = new Map(); // id → [id]
    this.sinks = new Map(); // id → [id]
    this.events = [];
    this.changed = new Set(); // ids whose lastChange moved in the last update
    this.info = null;
  }

  /** Merge a snapshot from the page hook. Returns false if the page restarted. */
  update(snap, maxEvents = 2000) {
    if (snap.seq < this.seq) {
      this.reset();
      return false;
    }
    const previous = this.nodes;
    this.nodes = new Map(snap.nodes.map((node) => [node.id, node]));
    this.changed = new Set();
    for (const node of snap.nodes) {
      const before = previous.get(node.id);
      if (before && (before.lastChange !== node.lastChange || before.notifies !== node.notifies)) this.changed.add(node.id);
    }
    this.edges = snap.edges;
    this.sources = new Map();
    this.sinks = new Map();
    for (const [from, to] of snap.edges) {
      push(this.sources, to, from);
      push(this.sinks, from, to);
    }
    this.events.push(...snap.events);
    if (this.events.length > maxEvents) this.events.splice(0, this.events.length - maxEvents);
    this.seq = snap.seq;
    this.info = {
      base: snap.base,
      provided: snap.provided,
      runtimes: snap.runtimes,
      settings: snap.settings,
      dropped: snap.dropped,
    };
    return true;
  }

  /** Every id upstream (sources) or downstream (sinks) of `id`. */
  reach(id, direction) {
    const map = direction === 'up' ? this.sources : this.sinks;
    const seen = new Set();
    const stack = [...(map.get(id) ?? [])];
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(map.get(next) ?? []));
    }
    return seen;
  }
}

function push(map, key, value) {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else map.set(key, [value]);
}

/**
 * Columns left to right by longest path from a source (states first, watchers last), ordered
 * within a column by the average row of their sources so edges cross less.
 * Returns Map id → { column, row }.
 */
export function layout(ids, edges) {
  const set = new Set(ids);
  const incoming = new Map(ids.map((id) => [id, []]));
  for (const [from, to] of edges) if (set.has(from) && set.has(to) && from !== to) incoming.get(to).push(from);

  const column = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (column.has(id)) return column.get(id);
    if (visiting.has(id)) return 0; // a cycle (shouldn't happen in a signal graph): cut it
    visiting.add(id);
    let d = 0;
    for (const from of incoming.get(id)) d = Math.max(d, depth(from) + 1);
    visiting.delete(id);
    column.set(id, d);
    return d;
  };
  for (const id of ids) depth(id);

  const columns = [];
  for (const id of ids) (columns[column.get(id)] ??= []).push(id);
  const row = new Map();
  for (const list of columns) {
    if (!list) continue;
    const score = (id) => {
      const from = incoming.get(id).filter((f) => row.has(f));
      return from.length ? from.reduce((sum, f) => sum + row.get(f), 0) / from.length : Infinity;
    };
    const scored = list.map((id, index) => [id, score(id), index]);
    scored.sort((a, b) => (a[1] === b[1] ? a[2] - b[2] : a[1] === Infinity ? 1 : b[1] === Infinity ? -1 : a[1] - b[1]));
    scored.forEach(([id], index) => row.set(id, index));
  }
  return new Map(ids.map((id) => [id, { column: column.get(id), row: row.get(id) }]));
}

export function describeEvent(event, name) {
  switch (event.type) {
    case 'create':
      return 'created';
    case 'set':
      return event.changed ? `${event.from} → ${event.to}` : `${event.to} (unchanged)`;
    case 'run': {
      const because = event.causes?.length ? ` because ${event.causes.map(name).join(', ')} changed` : '';
      if (event.first) return `first run → ${event.to} (${event.ms} ms)`;
      return `${event.changed ? `→ ${event.to}` : 'same value'}${because} (${event.ms} ms)`;
    }
    case 'error':
      return `threw ${event.error}`;
    case 'notify':
      return 'notified: something it watches went dirty';
    default:
      return event.type;
  }
}
