// The playground's starting programs. Each teaches one property of the proposal and is short
// enough to read in the editor without scrolling far.

export const EXAMPLES = [
  {
    id: 'counter',
    title: 'Counter',
    code: `// A State holds a value. A Computed derives one.
// Click "+1" and watch the write travel through the graph.
const count = new Signal.State(0, { name: 'count' });
const doubled = new Signal.Computed(() => count.get() * 2, { name: 'doubled' });

ui.button('+1', () => count.set(count.get() + 1));
ui.show('count', count);
ui.show('doubled', doubled);
`,
  },
  {
    id: 'cut-off',
    title: 'Equality cut-off',
    code: `// A Computed whose value doesn't change stops the update there.
// "+2" changes count but not parity, so "render" never re-runs.
const count = new Signal.State(0, { name: 'count' });
const isEven = new Signal.Computed(() => count.get() % 2 === 0, { name: 'isEven' });
const parity = new Signal.Computed(() => (isEven.get() ? 'even' : 'odd'), { name: 'parity' });

effect(() => log('parity is', parity.get()), 'render');

ui.button('+1', () => count.set(count.get() + 1));
ui.button('+2', () => count.set(count.get() + 2));
ui.show('count', count);
`,
  },
  {
    id: 'diamond',
    title: 'Diamond, glitch-free',
    code: `// Two paths from one source meet again. The proposal guarantees
// "sum" never sees one side updated and the other stale, and runs once per write.
const a = new Signal.State(1, { name: 'a' });
const b = new Signal.Computed(() => a.get() * 10, { name: 'b' });
const c = new Signal.Computed(() => a.get() + 100, { name: 'c' });
const sum = new Signal.Computed(() => {
  const value = b.get() + c.get();
  log(\`sum ran: b=\${b.get()} c=\${c.get()} → \${value}\`);
  return value;
}, { name: 'sum' });

effect(() => sum.get(), 'render');
ui.slider('a', a, { min: 0, max: 10 });
`,
  },
  {
    id: 'dynamic',
    title: 'Dynamic dependencies',
    code: `// A Computed depends on what it read last time, nothing more.
// Flip the toggle: the edge to "first" or "nickname" moves.
const useNickname = new Signal.State(false, { name: 'useNickname' });
const first = new Signal.State('Ada', { name: 'first' });
const nickname = new Signal.State('Countess', { name: 'nickname' });

const greeting = new Signal.Computed(
  () => \`Hello, \${useNickname.get() ? nickname.get() : first.get()}\`,
  { name: 'greeting' },
);

effect(() => log(greeting.get()), 'render');
ui.toggle('use nickname', useNickname);
ui.text('first', first);
ui.text('nickname', nickname);
`,
  },
  {
    id: 'lazy',
    title: 'Lazy until read',
    code: `// A Computed does no work until something reads it,
// and nothing tracks it back from its sources until a Watcher depends on it.
const price = new Signal.State(20, { name: 'price' });
const expensive = new Signal.Computed(() => {
  log('expensive ran');
  return price.get() * 1.2;
}, { name: 'expensive' });

ui.slider('price', price, { min: 0, max: 100 });
ui.button('Read it once', () => log('value:', expensive.get()));
ui.button('Watch it', () => effect(() => expensive.get(), 'watch expensive'));
// Change the price before and after "Watch it": dashed outlines are not live.
`,
  },
  {
    id: 'watcher',
    title: 'Watchers by hand',
    code: `// effect() is a helper. Underneath it is the proposal's Watcher:
// notify is called synchronously when something it watches goes dirty,
// and you decide when to re-read (here, once per microtask).
const name = new Signal.State('world', { name: 'name' });
const message = new Signal.Computed(() => \`hello, \${name.get()}\`, { name: 'message' });

let queued = false;
const watcher = new Signal.subtle.Watcher(() => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const signal of watcher.getPending()) log('pending:', signal.get());
    watcher.watch(); // re-arm
  });
});
watcher.watch(message);
message.get();

ui.text('name', name);
ui.button('Write three times', () => {
  name.set('a'); name.set('b'); name.set('c'); // one notification, one read
});
`,
  },
  {
    id: 'errors',
    title: 'Errors',
    code: `// A Computed that throws caches the error and rethrows it to every reader,
// until a source changes and it runs again.
const qty = new Signal.State(2, { name: 'qty' });
const broken = new Signal.State(false, { name: 'taxServiceDown' });
const subtotal = new Signal.Computed(() => qty.get() * 12, { name: 'subtotal' });
const tax = new Signal.Computed(() => {
  if (broken.get()) throw new Error('tax service unavailable');
  return subtotal.get() * 0.06;
}, { name: 'tax' });
const total = new Signal.Computed(() => subtotal.get() + tax.get(), { name: 'total' });

effect(() => {
  try { log('total', total.get().toFixed(2)); }
  catch (error) { log('total failed:', error.message); }
}, 'render');

ui.slider('qty', qty, { min: 0, max: 10 });
ui.toggle('tax service down', broken);
`,
  },
  {
    id: 'interval',
    title: 'Timers',
    code: `// Timers started here are stopped when the code runs again.
const seconds = new Signal.State(0, { name: 'seconds' });
const clock = new Signal.Computed(() => {
  const s = seconds.get();
  return \`\${Math.floor(s / 60)}:\${String(s % 60).padStart(2, '0')}\`;
}, { name: 'clock' });
const minute = new Signal.Computed(() => Math.floor(seconds.get() / 60), { name: 'minute' });

setInterval(() => seconds.set(seconds.get() + 1), 1000);
ui.show('clock', clock);
effect(() => log('a new minute:', minute.get()), 'on minute');
`,
  },
];
