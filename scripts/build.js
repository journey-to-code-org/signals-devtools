// Bundles the page hook (src/hook.js + signal-polyfill) into extension/hook.js, then zips the
// extension for the stores: `npm run build`.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
if (manifest.version !== version) throw new Error(`manifest.json is ${manifest.version}, package.json is ${version}`);

await build({
  entryPoints: ['src/hook.js'],
  outfile: 'extension/hook.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'inline',
  banner: {
    js: `// Signals Inspector ${version} page hook. Generated from src/ by scripts/build.js; edit those.\n// Includes signal-polyfill (Apache-2.0, https://github.com/proposal-signals/signal-polyfill).`,
  },
});

mkdirSync('dist', { recursive: true });
const zip = `dist/signals-inspector-${version}.zip`;
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', `../${zip}`, '.', '-x', '.*'], { cwd: 'extension', stdio: 'inherit' });
console.log(`built extension/hook.js and ${zip}`);
