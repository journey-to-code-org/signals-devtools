// End to end: load the unpacked extension in Chromium, open the demo on localhost (where the
// content script injects the hook), drive it, then open the real panel.html in a second page
// whose bridge evaluates in the demo page — the same JSON the DevTools panel gets.
//
//   npm run build && npm run test:browser
//   CHROME=/path/to/chrome  (Chrome for Testing or Chromium; branded Chrome can't load unpacked extensions)
//   SHOTS=dir               (write screenshots there)
//   EXTRA_PAGE=url          (also check that the hook is on another page, e.g. a Zubra app)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '../scripts/serve.js';

const extension = resolve('extension');
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const server = await serve({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'signals-')), {
  executablePath: process.env.CHROME,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1100, height: 700 },
});

const failures = [];
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`ok - ${label}`);
  } catch (error) {
    failures.push(label);
    console.log(`not ok - ${label}\n  ${error.message.split('\n').join('\n  ')}`);
  }
};

try {
  const demo = await context.newPage();
  const errors = [];
  demo.on('pageerror', (e) => errors.push(e.message));
  await demo.goto(`${origin}/demo/`);

  await check('the hook is injected before page scripts and provides Signal', async () => {
    const info = await demo.evaluate(() => ({
      hook: typeof globalThis.__SIGNALS_DEVTOOLS_HOOK__?.snapshot,
      provided: globalThis.Signal === globalThis.__SIGNALS_DEVTOOLS_HOOK__?.Signal,
      text: document.getElementById('count').textContent,
    }));
    assert.deepEqual(info, { hook: 'function', provided: true, text: '0' });
    assert.deepEqual(errors, []);
  });

  await demo.click('#inc');
  await demo.click('#add2');
  await demo.fill('#qty', '3');

  await check('writes, runs and causes are recorded in the page', async () => {
    const snap = await demo.evaluate(() => globalThis.__SIGNALS_DEVTOOLS_HOOK__.snapshot());
    const by = Object.fromEntries(snap.nodes.map((n) => [n.label, n]));
    assert.equal(by.count.value, '3');
    assert.equal(by.count.sets, 2);
    assert.equal(by.parity.value, '"odd"');
    assert.deepEqual(by.subtotal.causes, [by.qty.id]);
    assert.equal(by.unused.unread, true);
    assert.equal(by.unused.live, false);
    assert.equal(by.count.site.url, `${origin}/demo/`, 'creation site points at the page, not the hook');
    // +2 didn't change parity, so "render parity" ran only for the +1.
    const renders = snap.events.filter((e) => e.type === 'run' && e.id === by['render parity'].id);
    assert.equal(renders.length, 2);
  });

  // The panel, fed by the demo page.
  const panel = await context.newPage();
  await panel.exposeFunction('__evalInDemo', (code) => demo.evaluate(code));
  await panel.addInitScript(() => {
    globalThis.__SIGNALS_PANEL_BRIDGE__ = {
      async eval(code) {
        try {
          return { result: await globalThis.__evalInDemo(code) };
        } catch (error) {
          return { error: String(error) };
        }
      },
      openResource() {},
      theme: new URL(location.href).searchParams.get('theme') ?? 'default',
    };
  });
  await panel.goto(`${origin}/extension/panel.html`);

  await check('the panel lists the signals', async () => {
    await panel.waitForSelector('#list tbody tr', { timeout: 5000 });
    const names = await panel.$$eval('#list tbody tr td:nth-child(2)', (tds) => tds.map((td) => td.textContent));
    for (const name of ['count', 'isEven', 'parity', 'subtotal', 'tax', 'total', 'unused']) assert.ok(names.includes(name), `${name} in ${names}`);
    assert.match(await panel.textContent('#status'), /Signal provided on this page \(instrumented polyfill\)/);
  });

  await check('selecting a computed explains its last run', async () => {
    await panel.click('#list tbody tr:has(td:text-is("subtotal"))');
    const detail = await panel.textContent('#detail');
    assert.match(detail, /Re-ran because these changed/);
    assert.match(detail, /qty/);
    assert.match(detail, /Reads \(2\)/);
    if (shots) await panel.screenshot({ path: join(shots, 'list.png') });
  });

  await check('a state can be written from the panel', async () => {
    await panel.click('#list tbody tr:has(td:text-is("price"))');
    await panel.fill('#detail input', '20');
    await panel.press('#detail input', 'Enter');
    await demo.waitForFunction(() => document.getElementById('subtotal').textContent === '60', null, { timeout: 3000 });
  });

  await check('errors in a computed show in the panel', async () => {
    await demo.click('#bad');
    await panel.waitForTimeout(800);
    await panel.click('#list tbody tr:has(td:text-is("tax"))');
    const value = await panel.textContent('#detail .value');
    assert.match(value, /tax service unavailable/);
  });

  await check('the graph draws every edge', async () => {
    await panel.click('[data-view="graph"]');
    await panel.click('#list tbody tr:has(td:text-is("subtotal"))').catch(() => {});
    const count = await panel.$$eval('#graph-svg .gnode', (g) => g.length);
    const edges = await panel.$$eval('#graph-svg .gedge', (p) => p.length);
    assert.ok(count >= 12, `${count} nodes`);
    assert.ok(edges >= 10, `${edges} edges`);
    if (shots) await panel.screenshot({ path: join(shots, 'graph.png') });
  });

  await check('the timeline reads as sentences', async () => {
    await panel.click('[data-view="timeline"]');
    const text = await panel.textContent('#timeline');
    assert.match(text, /because qty changed/);
    assert.match(text, /threw Error: tax service unavailable/);
    if (shots) await panel.screenshot({ path: join(shots, 'timeline.png') });
  });

  await check('dark theme', async () => {
    const dark = await context.newPage();
    await dark.exposeFunction('__evalInDemo', (code) => demo.evaluate(code));
    await dark.addInitScript(() => {
      globalThis.__SIGNALS_PANEL_BRIDGE__ = { eval: async (code) => ({ result: await globalThis.__evalInDemo(code) }), openResource() {}, theme: 'dark' };
    });
    await dark.goto(`${origin}/extension/panel.html`);
    await dark.waitForSelector('#list tbody tr');
    await dark.click('[data-view="graph"]');
    await dark.waitForTimeout(600);
    assert.equal(await dark.evaluate(() => document.documentElement.dataset.theme), 'dark');
    if (shots) await dark.screenshot({ path: join(shots, 'graph-dark.png') });
    await dark.close();
  });

  await check('pages outside the matches get no hook', async () => {
    const other = await context.newPage();
    await other.goto(`data:text/html,<p>hi</p>`);
    assert.equal(await other.evaluate(() => typeof globalThis.__SIGNALS_DEVTOOLS_HOOK__), 'undefined');
    await other.close();
  });

  if (process.env.EXTRA_PAGE) {
    await check(`hook on ${process.env.EXTRA_PAGE}`, async () => {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.goto(process.env.EXTRA_PAGE);
      await page.waitForTimeout(1000);
      const snap = await page.evaluate(() => globalThis.__SIGNALS_DEVTOOLS_HOOK__?.snapshot());
      assert.ok(snap, 'hook present');
      assert.deepEqual(pageErrors, []);
      console.log(`  ${snap.nodes.length} nodes, ${snap.edges.length} edges, ${snap.events.length} events`);
      globalThis.extraPage = page;
    });
  }
} finally {
  if (!process.env.KEEP) {
    await context.close();
    server.close();
  }
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exitCode = failures.length ? 1 : 0;
