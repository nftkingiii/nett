// Nett HTTP server: JSON API plus the built web app. No framework; three routes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildComparison, holdings, listStocks, showcase } from './lib/nett.js';
import { hasCredentials } from './lib/web3api.js';
import { prepareSell, prepareTrade, tradeStatus, TradeError, TRADE_LIMITS } from './lib/trade.js';
import { agentLimitPlan, agentPlan, agentSellPlan, agentVerify } from './lib/agent.js';

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

async function readJson(req, limit = 4096) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new TradeError('too_large', 'Request body too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new TradeError('bad_json', 'Request body must be JSON.');
  }
}

const TRADE_STATUS = { bad_wallet: 400, bad_amount: 400, bad_hash: 400, bad_json: 400, too_large: 413, not_found: 404, unknown_version: 404 };

// Company and issuer logos, proxied same-origin. Binance's image CDN stalls some cross-site
// requests, so the server fetches allowlisted hosts with a timeout and caches the bytes.
const LOGO_HOSTS = new Set(['onchainos.bnbstatic.com', 'public.bnbstatic.com', 'bin.bnbstatic.com']);
const logoCache = new Map();
async function serveLogo(res, raw) {
  let target;
  try {
    target = new URL(raw ?? '');
  } catch {
    return send(res, 400, { error: 'Bad logo URL.' });
  }
  if (target.protocol !== 'https:' || !LOGO_HOSTS.has(target.hostname)) return send(res, 400, { error: 'Logo host not allowed.' });
  let hit = logoCache.get(target.href);
  if (!hit) {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    const type = upstream?.headers.get('content-type') ?? '';
    if (!upstream?.ok || !type.startsWith('image/')) return send(res, 404, { error: 'Logo unavailable.' });
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > 512 * 1024) return send(res, 413, { error: 'Logo too large.' });
    hit = { type, body };
    if (logoCache.size > 800) logoCache.delete(logoCache.keys().next().value);
    logoCache.set(target.href, hit);
  }
  res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400' });
  return res.end(hit.body);
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
  res.on('finish', () => {
    if (res.statusCode >= 400) console.warn(`${res.statusCode} ${req.method} ${url.pathname}`);
  });
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress;
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, revision: REVISION, quotes: hasCredentials() });
    }
    if (url.pathname === '/api/logo') return serveLogo(res, url.searchParams.get('u'));
    if (url.pathname === '/api/showcase') {
      return send(res, 200, await showcase());
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
    if (url.pathname === '/api/trade/prepare' && req.method === 'POST') {
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests; wait a minute.' });
      try {
        const body = await readJson(req);
        const ticker = String(body.ticker ?? '').trim().toUpperCase();
        const symbol = String(body.symbol ?? '').trim();
        if (!/^[A-Z0-9.]{1,12}$/.test(ticker) || !/^[A-Za-z0-9.]{1,16}$/.test(symbol)) {
          return send(res, 400, { error: 'Choose a stock and a version.' });
        }
        if (body.side === 'sell') {
          return send(res, 200, await prepareSell({ ticker, symbol, percent: Number(body.percent), wallet: body.wallet }));
        }
        return send(res, 200, await prepareTrade({ ticker, symbol, usd: Number(body.usd), wallet: body.wallet }));
      } catch (err) {
        if (err instanceof TradeError) return send(res, TRADE_STATUS[err.code] ?? 409, { error: err.message, code: err.code });
        throw err;
      }
    }
    if (url.pathname === '/api/trade/status') {
      try {
        return send(res, 200, await tradeStatus(url.searchParams.get('txHash')));
      } catch (err) {
        if (err instanceof TradeError) return send(res, 400, { error: err.message, code: err.code });
        throw err;
      }
    }
    if (url.pathname === '/api/holdings') {
      const address = url.searchParams.get('address') ?? '';
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return send(res, 400, { error: 'Not a wallet address.' });
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests; wait a minute.' });
      return send(res, 200, { address, holdings: await holdings(address) });
    }
    if (url.pathname.startsWith('/api/agent/')) {
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests; wait a minute.' });
      const q = url.searchParams;
      const ticker = (q.get('ticker') ?? '').trim().toUpperCase();
      if (url.pathname === '/api/agent/verify') {
        const txHash = q.get('txHash') ?? '';
        const token = q.get('token') ?? '';
        const wallet = q.get('wallet') || undefined;
        if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !/^0x[0-9a-fA-F]{40}$/.test(token) || (wallet && !/^0x[0-9a-fA-F]{40}$/.test(wallet))) {
          return send(res, 400, { error: 'Give txHash, token and optionally wallet as hex.' });
        }
        return send(res, 200, await agentVerify({ txHash, token, wallet, multiplier: Number(q.get('multiplier')) || null }));
      }
      if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) return send(res, 400, { error: 'Give a stock ticker, e.g. GOOGL.' });
      const usd = Number(q.get('usd') ?? '10');
      if (url.pathname === '/api/agent/plan') return send(res, 200, await agentPlan({ ticker, usd }));
      if (url.pathname === '/api/agent/sell-plan') {
        const symbol = (q.get('symbol') ?? '').trim();
        const wallet = q.get('wallet') ?? '';
        if (!/^[A-Za-z0-9.]{1,16}$/.test(symbol) || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
          return send(res, 400, { error: 'Give symbol (e.g. GOOGLB), wallet and percent (25, 50 or 100).' });
        }
        return send(res, 200, await agentSellPlan({ ticker, symbol, percent: Number(q.get('percent')), wallet }));
      }
      if (url.pathname === '/api/agent/limit-plan') {
        return send(res, 200, await agentLimitPlan({ ticker, usd, sharePrice: Number(q.get('sharePrice')) }));
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (url.pathname === '/api/trade/limits') return send(res, 200, TRADE_LIMITS);
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
