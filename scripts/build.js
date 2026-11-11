// Bundles the page hook (src/hook.js + signal-polyfill) into extension/hook.js, then packs:
//   dist/signals-inspector-<version>.zip         the extension, for every store
//   dist/signals-inspector-<version>-source.zip  the source, for addons.mozilla.org review
// `npm run build`. Node only, so it works the same on Windows, macOS and Linux.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { filesIn, zip } from './zip.js';

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
const pack = (out, root, names) => {
  writeFileSync(out, zip(names.map((name) => ({ name, data: readFileSync(`${root}${name}`) }))));
  console.log(`${out}: ${names.length} files`);
};

pack(`dist/signals-inspector-${version}.zip`, 'extension/', filesIn('extension'));

// The source as committed (git's own list of tracked files), for reviewers who rebuild it.
let tracked = null;
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
} catch {
  console.log('No git here: skipped the source zip.');
}
if (tracked) pack(`dist/signals-inspector-${version}-source.zip`, '', tracked);
