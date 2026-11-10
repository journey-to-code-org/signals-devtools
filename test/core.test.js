import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signal as Polyfill } from 'signal-polyfill';
import { createInspector, preview } from '../src/core.js';

const fresh = () => createInspector(Polyfill, { base: 'polyfill' });

function effect(Signal, fn) {
  const runs = [];
  const watcher = new Signal.subtle.Watcher(() => queueMicrotask(flush));
  const computed = new Signal.Computed(() => runs.push(fn()));
  const flush = () => {
    for (const s of watcher.getPending()) s.get();
    watcher.watch();
  };
  watcher.watch(computed);
  computed.get();
  return { runs, watcher, computed };
}

test('behaves like the base implementation', async () => {
  const { Signal } = fresh();
  const counter = new Signal.State(0);
  const isEven = new Signal.Computed(() => (counter.get() & 1) === 0);
  const parity = new Signal.Computed(() => (isEven.get() ? 'even' : 'odd'));
  const { runs } = effect(Signal, () => parity.get());
  counter.set(1);
  await Promise.resolve();
  counter.set(3); // parity unchanged: equality cut-off means no re-run
  await Promise.resolve();
  counter.set(4);
  await Promise.resolve();
  assert.deepEqual(runs, ['even', 'odd', 'even']);
  assert.ok(counter instanceof Polyfill.State);
  assert.ok(parity instanceof Polyfill.Computed);
  assert.equal(Signal.subtle.untrack, Polyfill.subtle.untrack);
  assert.deepEqual(Signal.subtle.introspectSources(parity), [isEven]);
});

test('custom equals and this binding are kept', () => {
  const { Signal } = fresh();
  const s = new Signal.State({ n: 1 }, { equals: (a, b) => a.n === b.n });
  let calls = 0;
  const c = new Signal.Computed(function () {
    calls++;
    assert.equal(this, c);
    return s.get().n;
  });
  assert.equal(c.get(), 1);
  s.set({ n: 1 });
  assert.equal(c.get(), 1);
  assert.equal(calls, 1);
});

test('records writes, runs and why a computed re-ran', () => {
  const { Signal, hook } = fresh();
  const a = hook.label(new Signal.State(1), 'a');
  const b = hook.label(new Signal.State(10), 'b');
  const sum = hook.label(new Signal.Computed(() => a.get() + b.get()), 'sum');
  const doubled = new Signal.Computed(() => sum.get() * 2, { name: 'doubled' });
  assert.equal(doubled.get(), 22);
  b.set(20);
  assert.equal(doubled.get(), 42);

  const snap = hook.snapshot();
  const byLabel = Object.fromEntries(snap.nodes.map((n) => [n.label, n]));
  assert.equal(byLabel.sum.value, '21');
  assert.deepEqual(byLabel.sum.causes, [byLabel.b.id]);
  assert.deepEqual(byLabel.doubled.causes, [byLabel.sum.id]);
  assert.equal(byLabel.b.sets, 1);
  assert.deepEqual(
    snap.edges.sort(),
    [[byLabel.a.id, byLabel.sum.id], [byLabel.b.id, byLabel.sum.id], [byLabel.sum.id, byLabel.doubled.id]].sort(),
  );
  const set = snap.events.find((e) => e.type === 'set');
  assert.deepEqual([set.from, set.to, set.changed], ['10', '20', true]);
  assert.ok(byLabel.a.site, 'creation site is recorded');
  assert.match(byLabel.a.site.url, /core\.test\.js$/);
});

test('an unchanged write is not a cause', () => {
  const { Signal, hook } = fresh();
  const a = new Signal.State(1);
  const b = new Signal.State(2);
  const c = new Signal.Computed(() => a.get() + b.get());
  c.get();
  a.set(1); // same value
  b.set(3);
  c.get();
  const node = hook.snapshot().nodes.find((n) => n.kind === 'computed');
  const bId = hook.snapshot().nodes.find((n) => n.value === '3').id;
  assert.deepEqual(node.causes, [bId]);
});

test('errors in computeds are recorded and still thrown', () => {
  const { Signal, hook } = fresh();
  const s = new Signal.State(0);
  const c = new Signal.Computed(() => {
    if (s.get() > 0) throw new Error('boom');
    return s.get();
  });
  c.get();
  s.set(1);
  assert.throws(() => c.get(), /boom/);
  const node = hook.snapshot().nodes.find((n) => n.kind === 'computed');
  assert.equal(node.error, true);
  assert.match(node.value, /boom/);
});

test('watchers report notifications and liveness', () => {
  const { Signal, hook } = fresh();
  const s = new Signal.State(0);
  const { watcher } = effect(Signal, () => s.get());
  s.set(1);
  const snap = hook.snapshot();
  assert.equal(snap.nodes.find((n) => n.kind === 'watcher').notifies, 1);
  assert.equal(snap.nodes.find((n) => n.kind === 'state').live, true);
  watcher.unwatch(...Signal.subtle.introspectSources(watcher));
  assert.equal(hook.snapshot().nodes.find((n) => n.kind === 'state').live, false);
});

test('writes during a notification still throw and are not recorded', () => {
  const { Signal, hook } = fresh();
  const s = new Signal.State(0);
  let error;
  const w = new Signal.subtle.Watcher(() => {
    try {
      s.set(5);
    } catch (e) {
      error = e;
    }
  });
  const c = new Signal.Computed(() => s.get());
  w.watch(c);
  c.get();
  s.set(1);
  assert.ok(error);
  assert.equal(hook.snapshot().events.filter((e) => e.type === 'set').length, 1);
});

test('register() reads a private runtime through introspection', () => {
  const { hook } = fresh();
  const Private = Polyfill; // stands in for a runtime's own copy, uninstrumented
  const count = new Private.State(2);
  const double = new Private.Computed(() => count.get() * 2);
  const watcher = new Private.subtle.Watcher(() => {});
  watcher.watch(double);
  double.get();
  hook.register({ name: 'my-runtime', Signal: Private, watchers: [watcher] });
  const snap = hook.snapshot();
  assert.deepEqual(snap.runtimes, [{ name: 'my-runtime', watchers: 1 }]);
  const kinds = snap.nodes.map((n) => [n.kind, n.runtime, n.value]).sort();
  assert.deepEqual(kinds, [['computed', 'my-runtime', '4'], ['state', 'my-runtime', '2'], ['watcher', 'my-runtime', null]]);
  assert.equal(snap.edges.length, 2);
});

test('setValue writes a state from DevTools', () => {
  const { Signal, hook } = fresh();
  const s = new Signal.State(1);
  const id = hook.snapshot().nodes[0].id;
  hook.setValue(id, '{"a":[1,2]}');
  assert.deepEqual(s.get(), { a: [1, 2] });
  hook.setValue(id, 'plain text');
  assert.equal(s.get(), 'plain text');
});

test('events are incremental', () => {
  const { Signal, hook } = fresh();
  const s = new Signal.State(0);
  const first = hook.snapshot();
  s.set(1);
  const next = hook.snapshot(first.seq);
  assert.deepEqual(next.events.map((e) => e.type), ['set']);
});

test('preview keeps values short and JSON safe', () => {
  assert.equal(preview('x'.repeat(300)).length < 210, true);
  assert.equal(preview([1, 2, [3, [4]]]), '[1, 2, [3, Array(1)]]');
  assert.equal(preview(new Map([[1, 2]])), 'Map(1)');
  assert.equal(preview({ a: 1, f() {} }), '{a: 1, f: ƒ f()}');
  assert.equal(preview(10n), '10n');
});

test('creation sites look past libraries to the code that uses them', async () => {
  const { Signal, hook } = fresh();
  const lib = await import('./fixtures/node_modules/fake-framework/index.js');
  const runtime = await import('./fixtures/runtime.js');
  lib.state(Signal, 1);
  runtime.state(Signal, 2);
  hook.ignoreFrames('/fixtures/runtime\\.js');
  runtime.state(Signal, 3);
  const sites = hook.snapshot().nodes.map((n) => n.site.url.split('/').slice(-2).join('/'));
  assert.deepEqual(sites, ['test/core.test.js', 'fixtures/runtime.js', 'test/core.test.js']);
});
