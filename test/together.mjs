// The playground with the extension installed: the extension's panel sees the playground's signals.
//   npm run build && npm run build:playground && npm run test:together
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '../scripts/serve.js';

const extension = resolve('extension');
const server = await serve({ root: 'dist/playground', port: 0 });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'signals-')), {
  executablePath: process.env.CHROME,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
await context.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror\/5\.65\.16\/(.*)\.min\.js$/, (route, request) => {
  const path = request.url().match(/5\.65\.16\/(.*)\.min\.js$/)[1].replace(/^codemirror$/, 'lib/codemirror');
  route.fulfill({ contentType: 'text/javascript', body: readFileSync(`node_modules/codemirror/${path}.js`) });
});
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: 'text/css', body: '' }));
let failed = false;
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('.gnode');
  await page.click('#stage button:text-is("+1")');
  await page.waitForTimeout(300);
  const snap = await page.evaluate(() => globalThis.__SIGNALS_DEVTOOLS_HOOK__.snapshot());
  const labels = snap.nodes.map((n) => n.label).filter(Boolean);
  for (const name of ['count', 'doubled', 'effects', 'ui: count']) assert.ok(labels.includes(name), labels.join(','));
  const count = snap.nodes.find((n) => n.label === 'count');
  assert.equal(count.value, '1');
  assert.ok(snap.events.some((e) => e.type === 'set' && e.id === count.id));
  assert.equal(await page.locator('.gnode:has(.title:text-is("doubled")) .val').textContent(), '2');
  assert.deepEqual(errors, []);
  console.log('ok - the extension sees the playground\'s signals and writes');
} catch (error) {
  failed = true;
  console.log(`not ok - ${error.message}`);
} finally {
  await context.close();
  server.close();
}
process.exitCode = failed ? 1 : 0;
