/**
 * Standalone AI backend, for serving the built game from something other than
 * `vite preview`. Serves /api/ai/* and the static contents of dist/.
 *
 * The API key is held in memory by server/aiHandler.mjs and is not persisted.
 *
 *   npm run build && node server/index.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAiRequest } from './aiHandler.mjs';
import { stopEngineSync } from '../local-ai-engine/lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  if (await handleAiRequest(req, res)) return;

  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);

  // Never serve outside dist/.
  if (!path.resolve(file).startsWith(path.resolve(DIST))) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('not found — run `npm run build` first');
    return;
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`[shdowpit] serving dist/ and /api/ai on http://localhost:${PORT}`);
  console.log('[shdowpit] API key is held in memory only; it is not written to disk.');
});

function stopLocalAi() {
  try {
    stopEngineSync();
  } catch {
    /* already gone */
  }
}
server.on('close', stopLocalAi);
process.once('exit', stopLocalAi);
process.once('SIGINT', () => {
  stopLocalAi();
  process.exit(0);
});
process.once('SIGTERM', () => {
  stopLocalAi();
  process.exit(0);
});
