import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, nameOf, layout, describeEvent } from '../extension/model.js';

const snap = (over = {}) => ({
  seq: 3,
  base: 'polyfill',
  provided: true,
  runtimes: [],
  settings: {},
  dropped: false,
  nodes: [
    { id: 1, kind: 'state', label: 'count', lastChange: 1, notifies: 0, causes: [] },
    { id: 2, kind: 'computed', label: null, site: { url: 'http://localhost:5173/src/app.js?t=1', line: 4, column: 9, fn: null }, lastChange: 2, notifies: 0, causes: [1] },
    { id: 3, kind: 'watcher', label: null, site: null, lastChange: -1, notifies: 1, causes: [] },
  ],
  edges: [[1, 2], [2, 3]],
  events: [{ seq: 3, type: 'set', id: 1, from: '0', to: '1', changed: true }],
  ...over,
});

test('names come from the label, the creation site, or the id', () => {
  const model = new Model();
  model.update(snap());
  assert.equal(nameOf(model.nodes.get(1)), 'count');
  assert.equal(nameOf(model.nodes.get(2)), 'app.js:4');
  assert.equal(nameOf(model.nodes.get(3)), 'watcher #3');
});

test('updates track what changed and the graph both ways', () => {
  const model = new Model();
  model.update(snap());
  const next = snap({ seq: 5, events: [{ seq: 5, type: 'run', id: 2 }] });
  next.nodes[1] = { ...next.nodes[1], lastChange: 5 };
  model.update(next);
  assert.deepEqual([...model.changed], [2]);
  assert.deepEqual(model.sources.get(2), [1]);
  assert.deepEqual([...model.reach(1, 'down')].sort(), [2, 3]);
  assert.deepEqual([...model.reach(3, 'up')].sort(), [1, 2]);
  assert.equal(model.events.length, 2);
});

test('a page that restarted resets the model', () => {
  const model = new Model();
  model.update(snap({ seq: 50 }));
  assert.equal(model.update(snap({ seq: 3 })), false);
  assert.equal(model.nodes.size, 0);
});

test('layout puts sources left of what reads them', () => {
  const positions = layout([1, 2, 3, 4], [[1, 3], [2, 3], [3, 4], [1, 4]]);
  assert.equal(positions.get(1).column, 0);
  assert.equal(positions.get(2).column, 0);
  assert.equal(positions.get(3).column, 1);
  assert.equal(positions.get(4).column, 2);
  const rows = [positions.get(1).row, positions.get(2).row].sort();
  assert.deepEqual(rows, [0, 1]);
});

test('layout survives a cycle', () => {
  const positions = layout([1, 2], [[1, 2], [2, 1]]);
  assert.equal(positions.size, 2);
});

test('events read as sentences', () => {
  const name = (id) => ({ 1: 'count', 2: 'total' })[id];
  assert.equal(describeEvent({ type: 'set', from: '1', to: '2', changed: true }, name), '1 → 2');
  assert.equal(describeEvent({ type: 'run', causes: [1], changed: true, to: '4', ms: 0.1 }, name), '→ 4 because count changed (0.1 ms)');
  assert.equal(describeEvent({ type: 'run', first: true, to: '4', ms: 0 }, name), 'first run → 4 (0 ms)');
});
