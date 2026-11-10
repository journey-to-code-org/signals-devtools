// Builds the playground into one self-contained page:
//   dist/playground/page.html   page content only (what the artifact host wraps)
//   dist/playground/index.html  a full document, for GitHub Pages or any static host
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['playground/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'inline',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('playground/playground.css', 'utf8');
const cmCss = readFileSync('node_modules/codemirror/lib/codemirror.css', 'utf8');

const page = readFileSync('playground/page.html', 'utf8')
  .replace('/*CODEMIRROR_CSS*/', () => cmCss)
  .replace('/*PLAYGROUND_CSS*/', () => css)
  .replace('/*PLAYGROUND_JS*/', () => js);

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>
${page}
</html>
`;

mkdirSync('dist/playground', { recursive: true });
writeFileSync('dist/playground/page.html', page);
writeFileSync('dist/playground/index.html', full);
console.log(`dist/playground: ${(page.length / 1024).toFixed(0)} KB`);
