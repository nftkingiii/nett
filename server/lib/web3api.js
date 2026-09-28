// Signed client for the Binance Web3 API (https://web3.binance.com/en/dev-docs/authentication).
// Signature: Base64(HMAC-SHA256(timestamp + METHOD + "/build" + path?query + body, secret)).
import crypto from 'node:crypto';

const HOST = 'https://web3.binance.com';
const PREFIX = '/build';

export class Web3ApiError extends Error {
  constructor(code, msg, path) {
    super(`Web3 API ${code}: ${msg} (${path})`);
    this.code = code;
    this.path = path;
  }
}

export function hasCredentials(env = process.env) {
  return Boolean(env.WEB3_API_KEY && env.WEB3_SECRET_KEY);
}

// Query strings use encodeURIComponent so spaces become %20, exactly as sent on the wire;
// the signed path must match the wire byte-for-byte.
export function buildQuery(params = {}) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function sign({ timestamp, method, pathWithQuery, body = '', secret }) {
  const preHash = timestamp + method.toUpperCase() + PREFIX + pathWithQuery + body;
  return crypto.createHmac('sha256', secret).update(preHash, 'utf8').digest('base64');
}

// Local clocks drift; the API rejects timestamps more than 5 s off (40103). The error carries
// the server time, so learn the offset from it and retry once.
let clockOffsetMs = 0;
export const clockOffset = () => clockOffsetMs;

export function learnClockOffset(message, sentAtMs) {
  const match = /serverTime=(\S+Z)/.exec(message ?? '');
  if (!match) return false;
  const serverMs = Date.parse(match[1].replace(/(\.\d{3})\d+Z$/, '$1Z'));
  if (Number.isNaN(serverMs)) return false;
  clockOffsetMs = serverMs - sentAtMs;
  return true;
}

// A 42900 rate-limit refusal is retried once after a short pause; a second one is thrown.
export const RATE_LIMIT_RETRY_MS = 1200;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function call(method, path, opts = {}) {
  const sentAt = Date.now();
  try {
    return await send(method, path, opts);
  } catch (err) {
    if (err instanceof Web3ApiError && String(err.code) === '40103' && learnClockOffset(err.message, sentAt)) {
      return send(method, path, opts);
    }
    if (err instanceof Web3ApiError && String(err.code) === '42900' && opts.retryRateLimit !== false) {
      await pause((opts.retryDelayMs ?? RATE_LIMIT_RETRY_MS) + Math.random() * 400);
      return send(method, path, opts);
    }
    throw err;
  }
}

async function send(method, path, { params, body, env = process.env, timeoutMs = 15_000 } = {}) {
  if (!hasCredentials(env)) throw new Error('WEB3_API_KEY and WEB3_SECRET_KEY are not set.');
  const query = buildQuery(params);
  const pathWithQuery = query ? `${path}?${query}` : path;
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const timestamp = new Date(Date.now() + clockOffsetMs).toISOString();
  const headers = {
    'X-OC-APIKEY': env.WEB3_API_KEY,
    'X-OC-TIMESTAMP': timestamp,
    'X-OC-SIGN': sign({ timestamp, method, pathWithQuery, body: bodyText, secret: env.WEB3_SECRET_KEY }),
    'X-OC-NONCE': crypto.randomUUID(),
  };
  if (bodyText) headers['Content-Type'] = 'application/json';

  const res = await fetch(HOST + PREFIX + pathWithQuery, {
    method,
    headers,
    body: bodyText || undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Business errors arrive as HTTP 200 with a non-zero `code`.
  const json = await res.json().catch(() => null);
  if (!json) throw new Web3ApiError(`HTTP ${res.status}`, 'non-JSON response', path);
  if (String(json.code) !== '0') throw new Web3ApiError(json.code, json.msg ?? 'unknown error', path);
  return json.data;
}

// Trading API quote. `amount` is in the sell token's smallest unit. RFQ routes (Ondo, bStock)
// need `userWalletAddress`, which becomes the receiver of the RFQ order.
// Comparison quotes are reused for a short while, and identical requests in flight share one call,
// so visitors flicking between stocks do not spend the key's quote quota. Trades never use this:
// they fetch their own fresh quote to bind the swap.
export const QUOTE_TTL_MS = 20_000;
const quoteCache = new Map();

export function quote({ fromTokenAddress, toTokenAddress, amount, userWalletAddress }, opts) {
  const key = [fromTokenAddress, toTokenAddress, amount, userWalletAddress].join('|').toLowerCase();
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.promise;
  const promise = call('GET', '/api/v1/dex/aggregator/quote', {
    ...opts,
    params: { binanceChainId: 56, fromTokenAddress, toTokenAddress, amount, userWalletAddress },
  });
  quoteCache.set(key, { at: Date.now(), promise });
  // Failures are not cached; the next visitor asks again.
  promise.catch(() => quoteCache.get(key)?.promise === promise && quoteCache.delete(key));
  if (quoteCache.size > 500) quoteCache.delete(quoteCache.keys().next().value);
  return promise;
}
