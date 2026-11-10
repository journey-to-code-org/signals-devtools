// Drives the built playground in Chromium: every example runs without errors, the graph draws,
// controls write states, sharing round-trips. `npm run build:playground && npm run test:playground`
// CDN requests for CodeMirror are served from node_modules so this runs offline.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../scripts/serve.js';
import { EXAMPLES } from '../playground/examples.js';

const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const server = await serve({ root: 'dist/playground', port: 0 });
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });

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

async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  await context.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror\/5\.65\.16\/(.*)\.min\.js$/, (route, request) => {
    const path = request.url().match(/5\.65\.16\/(.*)\.min\.js$/)[1].replace(/^codemirror$/, 'lib/codemirror');
    route.fulfill({ contentType: 'text/javascript', body: readFileSync(`node_modules/codemirror/${path}.js`) });
  });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector('.gnode');
  return { context, page, errors };
}

try {
  const { context, page, errors } = await open();

  await check('opens on the first example with a drawn graph and CodeMirror', async () => {
    assert.equal(await page.locator('.CodeMirror').count(), 1);
    const titles = await page.$$eval('.gnode .title', (t) => t.map((x) => x.textContent));
    for (const name of ['count', 'doubled']) assert.ok(titles.includes(name), titles.join(','));
    await page.check('#helpers');
    const all = await page.$$eval('.gnode .title', (t) => t.map((x) => x.textContent));
    for (const name of ['ui: count', 'ui: doubled', 'effects']) assert.ok(all.includes(name), all.join(','));
    await page.uncheck('#helpers');
    assert.deepEqual(errors, []);
  });

  await check('a button write updates the page, the graph and the timeline', async () => {
    await page.click('#stage button:text-is("+1")');
    await page.waitForTimeout(300);
    const outs = await page.$$eval('#stage .out', (o) => o.map((x) => x.textContent));
    assert.deepEqual(outs, ['1', '2']);
    const doubled = await page.locator('.gnode:has(.title:text-is("doubled")) .val').textContent();
    assert.equal(doubled, '2');
    if (shots) {
      await page.click('#stage button:text-is("+1")');
      await page.waitForTimeout(260);
      await page.screenshot({ path: join(shots, 'pulse.png') });
    }
  });

  for (const example of EXAMPLES) {
    await check(`example "${example.title}" runs cleanly`, async () => {
      await page.selectOption('#example', example.id);
      await page.waitForTimeout(250);
      const consoleErrors = await page.$$eval('#console li.error', (l) => l.map((x) => x.textContent));
      assert.deepEqual(consoleErrors, []);
      assert.ok((await page.locator('.gnode').count()) >= 2);
      // press every button once
      for (const button of await page.$$('#stage button')) await button.click();
      await page.waitForTimeout(300);
      const after = await page.$$eval('#console li.error', (l) => l.map((x) => x.textContent));
      assert.deepEqual(after, []);
      assert.deepEqual(errors, []);
      if (shots) await page.screenshot({ path: join(shots, `example-${example.id}.png`) });
    });
  }

  await check('equality cut-off: +2 does not re-run render', async () => {
    await page.selectOption('#example', 'cut-off');
    await page.waitForTimeout(200);
    const before = await page.$$eval('#console li', (l) => l.length);
    await page.click('#stage button:text-is("+2")');
    await page.waitForTimeout(250);
    assert.equal(await page.$$eval('#console li', (l) => l.length), before);
    await page.click('#stage button:text-is("+1")');
    await page.waitForTimeout(250);
    assert.equal(await page.$$eval('#console li', (l) => l.length), before + 1);
  });

  await check('diamond: sum runs once per write with consistent sides', async () => {
    await page.selectOption('#example', 'diamond');
    await page.waitForTimeout(200);
    await page.locator('#stage input[type=range]').fill('3');
    await page.waitForTimeout(250);
    const lines = await page.$$eval('#console li', (l) => l.map((x) => x.textContent));
    assert.equal(lines.filter((l) => l.includes('→ 133')).length, 1, lines.join('\n'));
  });

  await check('selecting a node explains why it re-ran, and a state can be set', async () => {
    await page.selectOption('#example', 'counter');
    await page.waitForTimeout(200);
    await page.click('#stage button:text-is("+1")');
    await page.waitForTimeout(250);
    await page.click('.gnode:has(.title:text-is("doubled"))');
    const detail = await page.textContent('#detail');
    assert.match(detail, /Re-ran because these changed/);
    await page.click('.gnode:has(.title:text-is("count"))');
    await page.fill('#set-value', '20');
    await page.press('#set-value', 'Enter');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#stage .out').nth(1).textContent(), '40');
    if (shots) await page.screenshot({ path: join(shots, 'detail.png') });
  });

  await check('errors point at the line', async () => {
    await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('const a = new Signal.State(1);\n\nnope();\n'));
    await page.click('#run');
    await page.waitForTimeout(250);
    const text = await page.textContent('#console li.error');
    assert.match(text, /nope is not defined/);
    assert.match(text, /line 3/);
  });

  await check('unnamed signals are named by their line', async () => {
    await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('const a = new Signal.State(1);\nconst b = new Signal.Computed(() => a.get());\neffect(() => b.get());\n'));
    await page.click('#run');
    await page.waitForTimeout(250);
    const titles = await page.$$eval('.gnode .title', (t) => t.map((x) => x.textContent));
    assert.ok(['line 1', 'line 2', 'line 3'].every((n) => titles.includes(n)), titles.join(','));
  });

  await check('share links round-trip', async () => {
    await page.click('#share');
    await page.waitForTimeout(200);
    const hash = await page.evaluate(() => location.hash);
    assert.match(hash, /^#c[0-9a-f]+$/);
    const fresh = await context.newPage();
    await fresh.goto(url + hash);
    await fresh.waitForSelector('.gnode');
    assert.match(await fresh.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue()), /effect\(\(\) => b\.get\(\)\)/);
    await fresh.close();
  });

  await check('timers stop on re-run', async () => {
    await page.selectOption('#example', 'interval');
    await page.waitForTimeout(2300);
    await page.selectOption('#example', 'counter');
    await page.waitForTimeout(1300);
    assert.deepEqual(await page.$$eval('#console li.error', (l) => l.map((x) => x.textContent)), []);
    assert.deepEqual(errors, []);
  });

  for (const [scheme, name] of [['light', 'light'], ['dark', 'dark']]) {
    await check(`screenshot ${name}`, async () => {
      const view = await open({ colorScheme: scheme });
      await view.page.selectOption('#example', 'errors');
      await view.page.waitForTimeout(300);
      await view.page.click('.gnode:has(.title:text-is("total"))');
      await view.page.waitForTimeout(150);
      if (shots) await view.page.screenshot({ path: join(shots, `${name}.png`) });
      assert.deepEqual(view.errors, []);
      await view.context.close();
    });
  }

  await check('phone width: no horizontal page scroll', async () => {
    const phone = await open({ viewport: { width: 390, height: 844 } });
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `overflows by ${overflow}px`);
    if (shots) await phone.page.screenshot({ path: join(shots, 'phone.png'), fullPage: true });
    await phone.context.close();
  });

  await context.close();
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exitCode = failures.length ? 1 : 0;
