// A static server for the demo and the panel test: `npm run demo`, then open
// http://127.0.0.1:4173/demo/ with the extension installed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** Serve `root`, plus any `mounts` ({ '/prefix/': '/dir' }). Returns the http.Server. */
export function serve({ root = process.cwd(), port = 4173, mounts = {} } = {}) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let base = resolve(root);
    let rest = path;
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (path.startsWith(prefix)) {
        base = resolve(dir);
        rest = path.slice(prefix.length - 1);
      }
    }
    let file = normalize(join(base, rest));
    if (!file.startsWith(base)) return res.writeHead(403).end();
    if (file.endsWith('/')) file += 'index.html';
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve();
  console.log(`http://127.0.0.1:${server.address().port}/demo/`);
}
