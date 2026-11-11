# Building the extension

For addons.mozilla.org reviewers, and anyone who wants to check that the published extension matches this source.

Every file in `extension/` is committed as it ships, except `hook.js`, which `npm run build` generates: [esbuild](https://esbuild.github.io/) bundles `src/hook.js`, `src/core.js` and the [`signal-polyfill`](https://github.com/proposal-signals/signal-polyfill) package into one script. It isn't minified. Nothing else is generated or transformed.

## Environment

- Any OS. Tested on Ubuntu 24.04 and Windows 11.
- [Node.js](https://nodejs.org/) 22 or later, with npm 10 or later.
- No other tools: packing the zip uses Node alone.

## Steps

```sh
npm ci          # exact versions from package-lock.json (esbuild, signal-polyfill)
npm run build   # writes extension/hook.js and dist/signals-inspector-<version>.zip
```

`extension/` is then the extension, and `dist/signals-inspector-<version>.zip` is what was uploaded. To compare with an uploaded version, unzip it and diff it against `extension/`: they're identical.

`npm test` runs the unit tests. The browser tests (`npm run test:browser`) need Chromium and aren't needed to build.
