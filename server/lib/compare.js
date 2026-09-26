// Pure comparison logic: no network. Given one snapshot per provider token, decide which
// routes are safe to trade and which gives the most real shares for the money.
import { PROVIDERS } from './providers.js';

export const DEFAULT_POLICY = {
  // Beyond this distance from the reference price the route is shown with a warning.
  cautionPremiumPct: 1,
  // Beyond this distance the route is refused: the wrapper is not tracking the stock.
  maxPremiumPct: 3,
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// The reference is the underlying US stock price. Providers usually agree on it; when they
// do not, take the value most of them report so one stale feed cannot move the benchmark.
export function pickReference(snapshots) {
  const prices = snapshots.map((s) => num(s.referencePrice)).filter((p) => p !== null && p > 0);
  if (prices.length === 0) return null;
  const counts = new Map();
  for (const p of prices) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

export function assessRoute(token, snapshot, { reference, session, policy = DEFAULT_POLICY }) {
  const provider = PROVIDERS[token.type];
  const tokenPrice = num(snapshot.tokenPrice);
  const multiplier = num(snapshot.multiplier ?? token.multiplier);
  const reasons = [];
  let verdict = 'ok';
  const block = (code, message) => {
    verdict = 'blocked';
    reasons.push({ code, message, severity: 'block' });
  };
  const warn = (code, message) => {
    if (verdict === 'ok') verdict = 'caution';
    reasons.push({ code, message, severity: 'warn' });
  };
  const note = (code, message) => reasons.push({ code, message, severity: 'info' });

  const status = snapshot.status;
  if (status?.openState === false) {
    block('not_trading', status.reasonMsg || `Trading is paused (${status.reasonCode ?? 'no reason given'}).`);
  } else if (status?.reasonCode && status.reasonCode !== 'TRADING') {
    block('corporate_action', status.reasonMsg || `Trading is limited: ${status.reasonCode}.`);
  }

  let perShare = null;
  if (!(tokenPrice > 0) || !(multiplier > 0)) {
    block('no_price', 'No usable on-chain price or share multiplier for this token.');
  } else {
    perShare = tokenPrice / multiplier;
  }

  let premiumPct = null;
  if (perShare !== null && reference) {
    premiumPct = ((perShare - reference) / reference) * 100;
    const distance = Math.abs(premiumPct);
    if (distance > policy.maxPremiumPct) {
      block('off_reference', `Priced ${premiumPct.toFixed(2)}% away from the stock; the limit is ±${policy.maxPremiumPct}%.`);
    } else if (distance > policy.cautionPremiumPct) {
      warn('off_reference', `Priced ${premiumPct.toFixed(2)}% away from the stock.`);
    }
  } else if (perShare !== null) {
    warn('no_reference', 'No reference stock price to check this token against.');
  }

  if (session && session.openState === false) {
    if (provider.closedMarketError) {
      warn('market_closed', `US market is closed (${session.reasonMsg ?? 'closed'}); ${provider.name} orders may be refused until it reopens.`);
    }
    if (premiumPct !== null) {
      note('frozen_reference', 'The reference is the last US close; the on-chain price keeps moving.');
    }
  }

  return {
    symbol: token.symbol,
    address: token.address,
    provider: provider.id,
    providerName: provider.name,
    execution: provider.execution,
    tokenPrice,
    multiplier,
    perShare,
    premiumPct,
    verdict,
    reasons,
  };
}

// Rank routes for a side. Buying wants the lowest price per real share; selling the highest.
// Blocked routes are kept, last, so the user can see why they were refused.
export function rankRoutes(routes, side = 'buy') {
  const order = { ok: 0, caution: 1, blocked: 2 };
  const dir = side === 'sell' ? -1 : 1;
  return [...routes].sort((a, b) => {
    if (order[a.verdict] !== order[b.verdict]) {
      // A caution route can still beat an ok one on price; only blocked routes drop out.
      if (a.verdict === 'blocked' || b.verdict === 'blocked') return order[a.verdict] - order[b.verdict];
    }
    if (a.perShare === null) return 1;
    if (b.perShare === null) return -1;
    return dir * (a.perShare - b.perShare);
  });
}

export function compare(tokens, snapshots, { usd, side = 'buy', session = null, policy = DEFAULT_POLICY } = {}) {
  const reference = pickReference(snapshots);
  const routes = rankRoutes(
    tokens.map((t, i) => assessRoute(t, snapshots[i], { reference, session, policy })),
    side,
  );
  for (const r of routes) {
    r.sharesForUsd = usd && r.perShare ? usd / r.perShare : null;
  }
  const eligible = routes.filter((r) => r.verdict !== 'blocked' && r.perShare !== null);
  const best = eligible[0] ?? null;
  const worst = eligible.length > 1 ? eligible.at(-1) : null;
  // What picking the best eligible route instead of the worst one is worth, on either side.
  const edgePct = best && worst ? (Math.abs(best.perShare - worst.perShare) / worst.perShare) * 100 : null;
  return {
    reference,
    session,
    side,
    usd: usd ?? null,
    best: best?.symbol ?? null,
    edgePct,
    edgeUsd: edgePct !== null && usd ? (usd * edgePct) / 100 : null,
    routes,
    priceBasis: 'indicative', // listed on-chain price; executable quotes come from the Trading API
  };
}
