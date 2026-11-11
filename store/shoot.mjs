// Makes the store images in store/images/: four 1280x800 screenshots and the two promo tiles.
//   npm run build && npm run build:playground && CHROME=... node store/shoot.mjs
// The panel screenshots show the real panel.html, fed from the demo page through the same
// hook calls DevTools makes, inside a drawn browser frame (store/frame.html). FONTS=dir points
// at @fontsource packages so the playground's web fonts render without the network.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '../scripts/serve.js';

const out = 'store/images';
mkdirSync(out, { recursive: true });
const extension = resolve('extension');
const server = await serve({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const fonts = process.env.FONTS;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'shots-')), {
  executablePath: process.env.CHROME,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
await context.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror\/5\.65\.16\/(.*)\.min\.js$/, (route, request) => {
  const path = request.url().match(/5\.65\.16\/(.*)\.min\.js$/)[1].replace(/^codemirror$/, 'lib/codemirror');
  route.fulfill({ contentType: 'text/javascript', body: readFileSync(`node_modules/codemirror/${path}.js`) });
});
await context.route(/fonts\.googleapis\.com/, (route) => {
  if (!fonts) return route.fulfill({ contentType: 'text/css', body: '' });
  const face = (family, pkg, weight) => `@font-face{font-family:"${family}";font-weight:${weight};src:url(/__fonts/${pkg}/files/${pkg}-latin-${weight}-normal.woff2) format("woff2")}`;
  route.fulfill({
    contentType: 'text/css',
    body: [
      face('Bricolage Grotesque', 'bricolage-grotesque', 600),
      face('Bricolage Grotesque', 'bricolage-grotesque', 700),
      ...[400, 500, 600].map((w) => face('IBM Plex Sans', 'ibm-plex-sans', w)),
      ...[400, 500].map((w) => face('IBM Plex Mono', 'ibm-plex-mono', w)),
    ].join('\n'),
  });
});
await context.route(/\/__fonts\//, (route, request) => {
  const path = new URL(request.url()).pathname.replace('/__fonts/', '');
  route.fulfill({ contentType: 'font/woff2', body: readFileSync(join(fonts, '@fontsource', path)) });
});
// Inside the frame, the panel's bridge evaluates in the page iframe, as inspectedWindow.eval does.
await context.addInitScript(() => {
  if (!location.pathname.endsWith('/extension/panel.html') || window === window.top) return;
  const app = () => window.parent.document.getElementById('app').contentWindow;
  globalThis.__SIGNALS_PANEL_BRIDGE__ = {
    async eval(code) {
      try {
        const result = app().eval(code);
        return { result: result === undefined ? undefined : JSON.parse(JSON.stringify(result)) };
      } catch (error) {
        return { error: String(error) };
      }
    },
    openResource() {},
    theme: window.parent.document.documentElement.classList.contains('dark') ? 'dark' : 'default',
  };
});

async function frame({ dark, view, select, pageHeight = 300, act }) {
  const page = await context.newPage();
  await page.goto(`${origin}/store/frame.html`);
  await page.evaluate(({ dark, pageHeight }) => {
    document.documentElement.classList.toggle('dark', dark);
    document.body.style.setProperty('--page', `${pageHeight}px`);
  }, { dark, pageHeight });
  const app = page.frameLocator('#app');
  await page.evaluate((src) => (document.getElementById('app').src = src), `${origin}/demo/`);
  await app.locator('#count').waitFor();
  if (act) await act(app);
  await app.locator('body').evaluate(() => {
    document.activeElement?.blur();
    scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  await page.evaluate((src) => (document.getElementById('panel').src = src), `${origin}/extension/panel.html`);
  const panel = page.frameLocator('#panel');
  await panel.locator('#list tbody tr').first().waitFor();
  if (select) await panel.locator(`#list tbody tr:has(td:text-is("${select}"))`).click();
  if (view !== 'list') await panel.locator(`[data-view="${view}"]`).click();
  await page.waitForTimeout(700);
  return page;
}

const cart = async (app) => {
  await app.locator('#inc').click();
  await app.locator('#add2').click();
  await app.locator('#qty').fill('3');
  await app.locator('#price').fill('15');
};

// 1. Signals list with a computed explained.
let page = await frame({ dark: false, view: 'list', select: 'subtotal', act: cart });
await page.screenshot({ path: `${out}/1-signals.png` });
await page.close();

// 2. The graph, dark.
page = await frame({ dark: true, view: 'graph', pageHeight: 400, act: cart });
await page.screenshot({ path: `${out}/2-graph.png` });
await page.close();

// 3. Timeline with an error, dark.
page = await frame({
  dark: true,
  view: 'timeline',
  select: 'tax',
  act: async (app) => {
    await cart(app);
    await app.locator('#bad').click();
    await app.locator('#qty').fill('4');
  },
});
await page.screenshot({ path: `${out}/3-timeline.png` });
await page.close();

// 4. The playground, mid-pulse.
page = await context.newPage();
await page.goto(`${origin}/dist/playground/`);
await page.waitForSelector('.gnode');
await page.selectOption('#example', 'cut-off');
await page.waitForTimeout(500);
await page.click('#stage button:text-is("+1")');
await page.waitForTimeout(700);
await page.click('#stage button:text-is("+1")');
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/4-playground.png` });
await page.close();

// Promo tiles.
for (const [size, width, height] of [['small', 440, 280], ['marquee', 1400, 560]]) {
  page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}/store/promo.html?size=${size}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/promo-${size}-${width}x${height}.png` });
  await page.close();
}

await context.close();
server.close();
console.log(`images in ${out}/`);
