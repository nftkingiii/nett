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

// Official RWA token list (Ondo + bStock on BSC): names, logos, ratios, status, listed prices.
// One call returns everything, so cache it briefly and reuse it for Discover and Holdings.
let officialCache = { at: 0, tokens: null };
async function officialTokens() {
  if (!hasCredentials()) return [];
  if (officialCache.tokens && Date.now() - officialCache.at < 60 * 1000) return officialCache.tokens;
  const tokens = await call('GET', '/api/v1/dex/market/rwa/tokens', { params: { binanceChainId: 56 } }).catch(() => null);
  if (!tokens) return officialCache.tokens ?? [];
  // The endpoint has been seen returning duplicates; key by address.
  const unique = [...new Map(tokens.map((t) => [t.tokenContractAddress.toLowerCase(), t])).values()];
  officialCache = { at: Date.now(), tokens: unique };
  return unique;
}

const PROVIDER_BY_TYPE = { 1: 'ondo', 2: 'xstocks', 3: 'bstock' };

// Every stock with at least one BSC version: name, logo, versions, and listed price per real share.
export async function listStocks() {
  const [publicTokens, official] = await Promise.all([
    import('./rwa.js').then((m) => m.listBscTokens()),
    officialTokens(),
  ]);
  const byAddress = new Map(official.map((t) => [t.tokenContractAddress.toLowerCase(), t]));
  const byTicker = new Map();
  for (const t of publicTokens) {
    const key = t.ticker.toUpperCase();
    const o = byAddress.get(t.address.toLowerCase());
    const entry = byTicker.get(key) ?? { ticker: key, name: null, logo: null, versions: [] };
    if (o) {
      entry.name ??= o.underlyingName ?? null;
      entry.logo ??= o.tokenLogoUrl ?? null;
    }
    const price = Number(o?.tokenPrice);
    const ratio = Number(o?.tokenToShareRatio ?? t.multiplier);
    entry.versions.push({
      symbol: t.symbol,
      provider: PROVIDER_BY_TYPE[t.type],
      address: t.address,
      listedPerShare: price > 0 && ratio > 0 ? price / ratio : null,
      status: !o?.statusInfo ? null
        : o.statusInfo.reasonCode === 'MARKET_CLOSED' ? 'closed'
        : o.statusInfo.openState !== false && (o.statusInfo.reasonCode ?? 'TRADING') === 'TRADING' ? 'open'
        : 'halted',
      reason: o?.statusInfo?.reasonMsg ?? null,
    });
    byTicker.set(key, entry);
  }
  const order = { ondo: 0, xstocks: 1, bstock: 2 };
  const stocks = [...byTicker.values()].map((s) => {
    s.versions.sort((a, b) => order[a.provider] - order[b.provider]);
    const prices = s.versions.map((v) => v.listedPerShare).filter((p) => p > 0);
    s.listedGapPct = prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100 : null;
    return s;
  });
  return stocks.sort((a, b) => b.versions.length - a.versions.length || a.ticker.localeCompare(b.ticker));
}

// Tokenized stocks held by a wallet on BSC, converted from tokens into real shares.
export async function holdings(address) {
  const [stocks, pages] = await Promise.all([listStocks(), walletAssets(address)]);
  const versions = new Map();
  for (const s of stocks) for (const v of s.versions) versions.set(v.address.toLowerCase(), { stock: s, version: v });
  const { tokensForTicker } = await import('./rwa.js');
  const rows = [];
  for (const a of pages) {
    const hit = versions.get(a.tokenContractAddress?.toLowerCase());
    if (!hit) continue;
    const tokens = Number(a.rawBalance) / 1e18; // tokenized stocks on BSC use 18 decimals
    if (!(tokens > 0)) continue;
    const meta = (await tokensForTicker(hit.stock.ticker)).find((t) => t.address.toLowerCase() === hit.version.address.toLowerCase());
    const multiplier = Number(meta?.multiplier ?? 1);
    const shares = tokens * multiplier;
    rows.push({
      ticker: hit.stock.ticker,
      name: hit.stock.name,
      logo: hit.stock.logo,
      symbol: hit.version.symbol,
      provider: hit.version.provider,
      address: hit.version.address,
      tokens,
      multiplier,
      shares,
      valueUsd: hit.version.listedPerShare ? shares * hit.version.listedPerShare : null,
    });
  }
  return rows.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

async function walletAssets(address) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const data = await call('GET', '/api/v1/dex/balance/all-token-balances-by-address', {
      params: { address, chains: '56', excludeRiskToken: true, page, pageSize: 100 },
    });
    const assets = (Array.isArray(data) ? data : [data]).flatMap((d) => d?.tokenAssets ?? []);
    all.push(...assets);
    if (assets.length < 100) break;
  }
  return all;
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
