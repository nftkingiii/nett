// Nett HTTP server: JSON API plus the built web app. No framework; three routes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildComparison, listStocks } from './lib/nett.js';
import { hasCredentials } from './lib/web3api.js';

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
const REVISION = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.NETT_REVISION ?? 'local';
const MAX_USD = 1000;

// Every comparison spends API quota; cap each client at 20 per minute.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function parseCompareQuery(searchParams) {
  const ticker = (searchParams.get('ticker') ?? '').trim().toUpperCase();
  const usd = Number(searchParams.get('usd') ?? '10');
  const side = searchParams.get('side') ?? 'buy';
  if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) return { error: 'Choose a stock ticker, e.g. GOOGL.' };
  if (!(usd >= 1 && usd <= MAX_USD)) return { error: `Amount must be between $1 and $${MAX_USD}.` };
  if (side !== 'buy' && side !== 'sell') return { error: 'Side must be buy or sell.' };
  return { ticker, usd, side };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function serveStatic(res, urlPath) {
  const safe = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  let file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) return send(res, 404, { error: 'Not found' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': safe.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    return res.end(data);
  } catch {
    // Single-page app: unknown paths get index.html; missing build gets a clear message.
    try {
      file = path.join(ROOT, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
      return res.end(data);
    } catch {
      return send(res, 404, { error: 'Web app not built. Run npm run build.' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress;
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, revision: REVISION, quotes: hasCredentials() });
    }
    if (url.pathname === '/api/stocks') {
      return send(res, 200, { stocks: await listStocks() });
    }
    if (url.pathname === '/api/compare') {
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many comparisons; wait a minute.' });
      const q = parseCompareQuery(url.searchParams);
      if (q.error) return send(res, 400, { error: q.error });
      const result = await buildComparison(q);
      return send(res, result.notFound ? 404 : 200, result);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    return serveStatic(res, url.pathname);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} failed:`, err.message);
    return send(res, 502, { error: 'Market data is unavailable right now. Try again shortly.' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Nett listening on http://localhost:${PORT} (quotes: ${hasCredentials() ? 'live' : 'off'})`));
}
