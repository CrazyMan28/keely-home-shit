#!/usr/bin/env node
/**
 * Zero-dependency static server for the built app (dist/).
 * Tailscale terminates HTTPS and proxies to this on 127.0.0.1.
 *
 *   node deploy/serve.mjs [dir] [port]      (defaults: ./dist 8787)
 *   env: HOST (default 127.0.0.1), PORT, SITE_DIR,
 *        AUTO_PORT=1  try the next ports if the chosen one is busy
 *        OPEN=1       open the app in the default browser once it's running
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.env.SITE_DIR ?? process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? process.argv[3] ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function fileFor(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const full = normalize(join(root, p));
  if (full !== root && !full.startsWith(root + sep)) return null; // path traversal
  try {
    const s = await stat(full);
    if (s.isDirectory()) {
      const idx = join(full, 'index.html');
      return { path: idx, stat: await stat(idx) };
    }
    return { path: full, stat: s };
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY }).end();
    return;
  }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', ...SECURITY }).end('ok');
    return;
  }
  let f = await fileFor(req.url ?? '/');
  // Single-page app: unknown routes without a file extension get index.html.
  if (!f && !extname((req.url ?? '').split('?')[0])) f = await fileFor('/index.html');
  if (!f) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY }).end('Not found');
    return;
  }
  const ext = extname(f.path).toLowerCase();
  const hashed = /[\\/]assets[\\/]/.test(f.path);
  const etag = `W/"${f.stat.size.toString(16)}-${Math.floor(f.stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, ...SECURITY }).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': f.stat.size,
    // Hashed build assets never change; the HTML shell must always revalidate.
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
    ...SECURITY,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(f.path).pipe(res);
});

let current = port;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && process.env.AUTO_PORT === '1' && current < port + 20) {
    current++;
    server.listen(current, host);
    return;
  }
  console.error(err.code === 'EADDRINUSE' ? `Port ${current} is already in use.` : err.message);
  process.exit(1);
});
server.on('listening', () => {
  const url = `http://${host === '127.0.0.1' || host === '0.0.0.0' ? 'localhost' : host}:${current}`;
  console.log(`\n  Home Planner is running:  ${url}\n\n  Keep this window open while you use it. Press Ctrl+C to stop.\n`);
  if (process.env.OPEN === '1') {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    } catch {
      /* no browser available */
    }
  }
});
server.listen(current, host);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
