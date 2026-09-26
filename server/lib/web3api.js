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

export async function call(method, path, { params, body, env = process.env, timeoutMs = 15_000 } = {}) {
  if (!hasCredentials(env)) throw new Error('WEB3_API_KEY and WEB3_SECRET_KEY are not set.');
  const query = buildQuery(params);
  const pathWithQuery = query ? `${path}?${query}` : path;
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const timestamp = new Date().toISOString();
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
export function quote({ fromTokenAddress, toTokenAddress, amount, userWalletAddress }, opts) {
  return call('GET', '/api/v1/dex/aggregator/quote', {
    ...opts,
    params: { binanceChainId: 56, fromTokenAddress, toTokenAddress, amount, userWalletAddress },
  });
}
