// Read-only tokenized-stock data from Binance's public wallet endpoints (no API key).
// These are the endpoints the official binance-tokenized-securities-info skill uses.
import { BSC_CHAIN_ID, PROVIDERS } from './providers.js';

const BASE = 'https://www.binance.com/bapi/defi';
const HEADERS = { 'Accept-Encoding': 'identity', 'User-Agent': 'nett/0.1 (+https://github.com/nftkingiii/nett)' };
const TOKEN_LIST_TTL_MS = 10 * 60 * 1000;

let tokenCache = { at: 0, tokens: null };

async function getJson(path, { timeoutMs = 10_000 } = {}) {
  const res = await fetch(BASE + path, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Binance data request failed: HTTP ${res.status} for ${path}`);
  const body = await res.json();
  if (body.code !== '000000' || body.success === false) {
    throw new Error(`Binance data error ${body.code}: ${body.message ?? body.msg ?? 'unknown'} for ${path}`);
  }
  return body.data;
}

// Every tokenized stock on BSC, across all providers.
export async function listBscTokens({ fresh = false } = {}) {
  if (!fresh && tokenCache.tokens && Date.now() - tokenCache.at < TOKEN_LIST_TTL_MS) {
    return tokenCache.tokens;
  }
  const types = Object.keys(PROVIDERS).map(Number);
  const lists = await Promise.all(
    types.map((type) =>
      getJson(`/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type=${type}`),
    ),
  );
  const tokens = lists
    .flatMap((list) => list ?? [])
    .filter((t) => t.chainId === BSC_CHAIN_ID && PROVIDERS[t.type])
    .map((t) => ({
      symbol: t.symbol,
      ticker: t.ticker,
      type: t.type,
      address: t.contractAddress,
      multiplier: t.multiplier,
    }));
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

export async function tokensForTicker(ticker) {
  const wanted = ticker.trim().toUpperCase();
  return (await listBscTokens()).filter((t) => t.ticker.toUpperCase() === wanted);
}

// Live price, multiplier, reference price and trading status for one token.
export async function tokenSnapshot(address) {
  const data = await getJson(
    `/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=${BSC_CHAIN_ID}&contractAddress=${address}`,
  );
  return {
    tokenPrice: data?.tokenInfo?.price ?? null,
    multiplier: data?.tokenInfo?.sharesMultiplier ?? null,
    referencePrice: data?.stockInfo?.price ?? null,
    status: data?.statusInfo ?? null,
    limits: data?.limitInfo ?? null,
  };
}

// Overall US market session as Binance reports it (Ondo market clock).
export async function marketStatus() {
  return getJson('/v1/public/wallet-direct/buw/wallet/market/token/rwa/market/status/ai');
}
