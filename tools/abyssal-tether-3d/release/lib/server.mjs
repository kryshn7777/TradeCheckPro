// Static file server for the release tests (Node >= 18, no dependencies).
//
// - serves a folder under an optional URL prefix (GitHub Pages style "/TradeCheckPro/abyssal-tether-3d/"
//   or the host root "/"),
// - can be stopped and restarted on the SAME port (offline tests: the browser keeps its origin),
// - sets the headers the production host sets (docs/abyssal-tether-3d/pwa/_headers.draft): sw.js and the
//   manifest are no-cache, everything else short-cache,
// - `latency`, `blockPaths` and `onRequest` hooks let tests simulate slow networks and half-finished deploys.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * @param {object} o
 * @param {string} o.root           folder to serve
 * @param {string} [o.prefix='/']   URL prefix the folder is mounted on
 * @param {number} [o.port=0]       0 = free port
 * @param {boolean} [o.prodHeaders=true]
 * @param {number} [o.latency=0]    ms added to every response
 */
export function createStaticServer({ root, prefix = '/', port = 0, prodHeaders = true, latency = 0 } = {}) {
  root = path.resolve(root);
  if (!prefix.startsWith('/')) prefix = '/' + prefix;
  if (!prefix.endsWith('/')) prefix += '/';
  const state = { root, prefix, latency, hits: [], blocked: new Set(), overrides: new Map(), onRequest: null };

  const handler = (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    state.hits.push({ method: req.method, path: pathname, range: req.headers.range || null });
    if (state.onRequest) state.onRequest(req, pathname);
    const send = () => {
      if (state.blocked.has(pathname)) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        return res.end('blocked by test');
      }
      if (pathname === prefix.slice(0, -1)) {
        res.writeHead(301, { location: prefix });
        return res.end();
      }
      if (!pathname.startsWith(prefix)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('outside prefix: ' + pathname);
      }
      let rel = pathname.slice(prefix.length);
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const override = state.overrides.get(rel);
      const file = path.join(root, path.normalize(rel));
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      const headers = {};
      const ext = path.extname(file).toLowerCase();
      headers['content-type'] = MIME[ext] || 'application/octet-stream';
      if (prodHeaders) {
        if (rel === 'sw.js' || rel === 'manifest.webmanifest' || rel === 'index.html') headers['cache-control'] = 'no-cache';
        else headers['cache-control'] = 'public, max-age=600';
        if (rel === 'sw.js') headers['service-worker-allowed'] = prefix;
      } else headers['cache-control'] = 'no-store';
      if (override !== undefined) {
        headers['content-length'] = Buffer.byteLength(override);
        res.writeHead(200, headers);
        return res.end(override);
      }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          return res.end('not found: ' + rel);
        }
        headers['content-length'] = st.size;
        res.writeHead(200, headers);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
      });
    };
    if (state.latency > 0) setTimeout(send, state.latency);
    else send();
  };

  let server = null;
  let boundPort = port;
  const api = {
    state,
    get port() {
      return boundPort;
    },
    get origin() {
      return `http://127.0.0.1:${boundPort}`;
    },
    get base() {
      return `http://127.0.0.1:${boundPort}${prefix}`;
    },
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.once('error', reject);
        server.listen(boundPort, '127.0.0.1', () => {
          boundPort = server.address().port;
          resolve(api);
        });
      });
    },
    /** Stops accepting AND drops open connections (a real outage). */
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve();
        const s = server;
        server = null;
        s.close(() => resolve());
        if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
      });
    },
    clearHits() {
      state.hits.length = 0;
    },
  };
  return api;
}
