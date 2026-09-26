// Assembles one comparison: token versions, live snapshots, the official reference price
// and an executable quote per version, then hands them to the pure ranking in compare.js.
import { compare } from './compare.js';
import { STABLES } from './providers.js';
import { marketStatus, tokenSnapshot, tokensForTicker } from './rwa.js';
import { call, hasCredentials, quote } from './web3api.js';

// RFQ quotes need a receiver. Before a wallet is connected, quote to the docs' example address;
// the quote is read-only and never becomes an order.
const PREVIEW_RECEIVER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

export function usdtUnits(usd) {
  return (BigInt(Math.round(usd * 100)) * 10n ** 16n).toString(); // USDT on BSC has 18 decimals
}

export function normalizeQuote(data) {
  const routes = Array.isArray(data) ? data : [data];
  const best = routes.find((r) => r?.isBest) ?? routes[0];
  if (!best) return { error: { code: 'empty', message: 'No route returned.' } };
  const decimals = Number(best.toToken?.decimal ?? 18);
  return {
    quoteId: best.quoteId,
    tokensOut: Number(best.toTokenAmount) / 10 ** decimals,
    executionMode: best.executionMode,
    vendorName: best.vendorName,
    priceImpactPercent: best.priceImpactPercent,
    hops: best.dexRouterList?.length ?? null,
  };
}

async function officialReference(tokens) {
  const results = await Promise.allSettled(
    tokens.map((t) =>
      call('GET', '/api/v1/dex/market/rwa/underlying-market', {
        params: { binanceChainId: 56, tokenContractAddress: t.address },
      }),
    ),
  );
  for (const r of results) {
    const price = Number(r.value?.marketData?.referencePrice);
    if (r.status === 'fulfilled' && price > 0) {
      return { price, source: 'Binance RWA Data API (underlying market)' };
    }
  }
  return null;
}

async function quoteAll(tokens, usd, receiver) {
  const amount = usdtUnits(usd);
  return Promise.all(
    tokens.map(async (t) => {
      try {
        const data = await quote({
          fromTokenAddress: STABLES.USDT.address,
          toTokenAddress: t.address,
          amount,
          userWalletAddress: receiver,
        });
        return normalizeQuote(data);
      } catch (err) {
        return { error: { code: Number(err.code) || err.code, message: err.message } };
      }
    }),
  );
}

// Stocks that have at least one BSC version, with names from the official list where available.
let stockCache = { at: 0, stocks: null };
export async function listStocks() {
  if (stockCache.stocks && Date.now() - stockCache.at < 10 * 60 * 1000) return stockCache.stocks;
  const [publicTokens, official] = await Promise.all([
    import('./rwa.js').then((m) => m.listBscTokens()),
    hasCredentials()
      ? call('GET', '/api/v1/dex/market/rwa/tokens', { params: { binanceChainId: 56 } }).catch(() => [])
      : [],
  ]);
  const names = new Map();
  for (const t of official ?? []) {
    if (t.underlyingTicker && t.underlyingName) names.set(t.underlyingTicker.toUpperCase(), t.underlyingName);
  }
  const byTicker = new Map();
  for (const t of publicTokens) {
    const key = t.ticker.toUpperCase();
    const entry = byTicker.get(key) ?? { ticker: key, name: names.get(key) ?? null, versions: [] };
    entry.versions.push(t.symbol);
    byTicker.set(key, entry);
  }
  const stocks = [...byTicker.values()].sort(
    (a, b) => b.versions.length - a.versions.length || a.ticker.localeCompare(b.ticker),
  );
  stockCache = { at: Date.now(), stocks };
  return stocks;
}

export async function buildComparison({ ticker, usd, side = 'buy', wallet }) {
  const tokens = await tokensForTicker(ticker);
  if (tokens.length === 0) return { ticker: ticker.toUpperCase(), routes: [], notFound: true };

  const live = hasCredentials();
  // Executable quotes are buy-side only for now (USDT → stock token).
  const wantQuotes = live && side === 'buy' && usd > 0;
  const [session, snapshots, reference, quotes] = await Promise.all([
    marketStatus(),
    Promise.all(tokens.map((t) => tokenSnapshot(t.address))),
    live ? officialReference(tokens) : null,
    wantQuotes ? quoteAll(tokens, usd, wallet ?? PREVIEW_RECEIVER) : [],
  ]);

  return {
    ticker: ticker.toUpperCase(),
    mode: wantQuotes ? 'executable' : 'listed',
    at: new Date().toISOString(),
    ...compare(tokens, snapshots, { usd, side, session, quotes, reference }),
  };
}
