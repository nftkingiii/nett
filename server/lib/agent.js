// Agent-facing Nett: a decision an AI agent can act on through the Binance Agentic Wallet (`baw`).
// Nett decides which version of a stock may be bought and at what share price; the Agentic Wallet
// executes. Every plan carries the guardrails the executor must enforce.
import { buildComparison, listStocks } from './nett.js';
import { STABLES } from './providers.js';
import { checkSale, formatUnits, tradeStatus } from './trade.js';

export const AGENT_GUARDRAILS = {
  maxUsd: 50,
  // The Agentic Wallet quote may differ from Nett's; refuse if it buys this much less stock.
  maxQuoteShortfallPct: 1,
  slippagePercent: '1',
  planTtlSeconds: 60,
};

// A token stands for `multiplier` shares, so its price is the share price × multiplier.
export const tokenTriggerPrice = (sharePrice, multiplier) => Number((sharePrice * multiplier).toFixed(6));

const round = (v, dp = 6) => (v === null || v === undefined ? null : Number(v.toFixed(dp)));

// Where the token's address comes from: Binance's official RWA list, or only the public wallet list.
async function provenance(ticker, address) {
  const stock = (await listStocks()).find((s) => s.ticker === ticker);
  const version = stock?.versions.find((v) => v.address.toLowerCase() === address.toLowerCase());
  return {
    listedBy: version?.status !== undefined && version?.status !== null ? 'binance-rwa-api' : 'binance-wallet-public-list',
    issuer: version?.provider ?? null,
    status: version?.status ?? null,
  };
}

export function bawArgs(kind, { fromToken, toToken, qty, triggerPrice }) {
  const base = ['--fromTokenQty', String(qty), '--fromToken', fromToken, '--toToken', toToken, '--binanceChainId', '56'];
  if (kind === 'quote') return ['market-order', 'quote', ...base, '--slippage', AGENT_GUARDRAILS.slippagePercent, '--json'];
  if (kind === 'swap') return ['market-order', 'swap', ...base, '--slippage', AGENT_GUARDRAILS.slippagePercent, '--json'];
  if (kind === 'limit') return ['limit-order', 'buy', '--triggerPrice', String(triggerPrice), ...base, '--slippage', AGENT_GUARDRAILS.slippagePercent, '--json'];
  throw new Error(`unknown baw command ${kind}`);
}

export async function agentPlan({ ticker, usd }) {
  if (!(usd >= 1 && usd <= AGENT_GUARDRAILS.maxUsd)) {
    return { decision: 'refuse', reason: `Agent buys are limited to $1–$${AGENT_GUARDRAILS.maxUsd}.` };
  }
  const c = await buildComparison({ ticker, usd, side: 'buy' });
  if (c.notFound) return { decision: 'refuse', ticker: c.ticker, reason: `${c.ticker} has no tokenized version on BNB Chain.` };
  if (c.mode !== 'executable') return { decision: 'refuse', ticker: c.ticker, reason: 'Live quotes are unavailable, so Nett cannot vouch for any version.' };

  const refused = c.routes
    .filter((r) => r.verdict === 'blocked')
    .map((r) => ({ symbol: r.symbol, address: r.address, reasons: r.reasons.filter((x) => x.severity === 'block').map((x) => x.message) }));
  const best = c.routes.find((r) => r.symbol === c.best);
  const now = Date.now();
  const common = {
    ticker: c.ticker,
    usd,
    reference: { price: c.reference, source: c.referenceSource },
    session: c.session ? { open: c.session.openState !== false, reason: c.session.reasonMsg ?? c.session.reasonCode ?? null } : null,
    refused,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AGENT_GUARDRAILS.planTtlSeconds * 1000).toISOString(),
  };
  if (!best) return { decision: 'refuse', reason: 'Every version failed a check.', ...common };

  const args = { fromToken: STABLES.USDT.address, toToken: best.address, qty: usd };
  return {
    decision: 'buy',
    ...common,
    chosen: {
      symbol: best.symbol,
      issuer: best.provider,
      address: best.address,
      multiplier: best.multiplier,
      perShare: round(best.perShare, 4),
      premiumPct: round(best.premiumPct, 3),
      expectedTokens: round(best.sharesForUsd / best.multiplier, 9),
      expectedShares: round(best.sharesForUsd, 9),
      warnings: best.reasons.filter((x) => x.severity === 'warn').map((x) => x.message),
      provenance: await provenance(c.ticker, best.address),
    },
    guardrails: {
      ...AGENT_GUARDRAILS,
      minTokensFromWalletQuote: round((best.sharesForUsd / best.multiplier) * (1 - AGENT_GUARDRAILS.maxQuoteShortfallPct / 100), 9),
      requireUserConfirmation: true,
      pollOrderUntil: ['FINISHED', 'FAILED'],
      tokenAudit: 'Binance token audit returns no data for tokenized stocks; disclose this and get explicit acknowledgment.',
    },
    baw: { quote: bawArgs('quote', args), swap: bawArgs('swap', args) },
  };
}

// "Buy when the share costs X": Agentic Wallet limit orders trigger on the token's USD price,
// and a token is `multiplier` shares, so the trigger is sharePrice × multiplier for each version.
export async function agentLimitPlan({ ticker, usd, sharePrice }) {
  if (!(sharePrice > 0)) return { decision: 'refuse', reason: 'Give the share price to buy at.' };
  const plan = await agentPlan({ ticker, usd });
  if (plan.decision !== 'buy') return plan;
  const { chosen } = plan;
  const triggerPrice = tokenTriggerPrice(sharePrice, chosen.multiplier);
  const gapPct = plan.reference.price ? ((sharePrice - plan.reference.price) / plan.reference.price) * 100 : null;
  return {
    ...plan,
    decision: 'limit',
    target: { sharePrice, tokenTriggerPrice: triggerPrice, vsReferencePct: round(gapPct, 3) },
    baw: { limit: bawArgs('limit', { fromToken: STABLES.USDT.address, toToken: chosen.address, qty: usd, triggerPrice }) },
    note: `${chosen.symbol} is ${chosen.multiplier} shares per token, so a $${sharePrice} share is a $${triggerPrice} token.`,
  };
}

// Issuers whose Agentic Wallet quantities are in share terms (tokens × multiplier). Verified for bStock on
// 27 Sep 2026: --fromTokenQty 0.014546257 sold 0.014546257 ÷ 1.000478 GOOGLB tokens. For the others it is
// unverified, so the token count is passed: if baw reads it as shares it sells slightly less, never more.
const SHARE_QTY_ISSUERS = new Set(['bstock']);

// The --fromTokenQty to pass for `amount` raw tokens (18 decimals), rounded down so the wallet
// never converts it back into more tokens than it holds.
export function bawSellQty(amount, multiplier, issuer) {
  if (!SHARE_QTY_ISSUERS.has(issuer) || !(multiplier > 0)) return { qty: formatUnits(amount), unit: 'tokens' };
  const scaled = BigInt(Math.floor(multiplier * 1e12)); // multiplier to 12 decimals, rounded down
  return { qty: formatUnits((amount * scaled) / 10n ** 12n), unit: 'shares' };
}

// "Sell part of what the Agentic Wallet holds": Nett checks the sale (status, balance, a live quote,
// price per real share against the stock); the Agentic Wallet executes it as a market order into USDT.
export async function agentSellPlan({ ticker, symbol, percent, wallet }) {
  let check;
  try {
    check = await checkSale({ ticker, symbol, percent, wallet });
  } catch (err) {
    if (err.code) return { decision: 'refuse', ticker, symbol, reason: err.message };
    throw err;
  }
  const { comparison, route, amount, tokens, usdtOut, sale } = check;
  const { qty, unit } = bawSellQty(amount, route.multiplier, route.provider);
  const now = Date.now();
  return {
    decision: 'sell',
    ticker: comparison.ticker,
    wallet,
    percent,
    reference: { price: comparison.reference, source: comparison.referenceSource },
    chosen: {
      symbol: route.symbol,
      issuer: route.provider,
      address: route.address,
      multiplier: route.multiplier,
      tokens: formatUnits(amount),
      shares: round(tokens * route.multiplier, 9),
      // What baw is given, and in which unit it reads it for this issuer.
      walletQty: qty,
      walletQtyUnit: unit,
      expectedUsdt: round(usdtOut, 6),
      perShare: round(sale.perShare, 4),
      premiumPct: round(sale.gapPct, 3),
      warnings: sale.verdict === 'caution' ? [`Sells ${Math.abs(sale.gapPct).toFixed(2)}% under the stock.`] : [],
    },
    guardrails: {
      ...AGENT_GUARDRAILS,
      minUsdtFromWalletQuote: round(usdtOut * (1 - AGENT_GUARDRAILS.maxQuoteShortfallPct / 100), 6),
      requireUserConfirmation: true,
      pollOrderUntil: ['FINISHED', 'FAILED'],
    },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AGENT_GUARDRAILS.planTtlSeconds * 1000).toISOString(),
    baw: {
      quote: bawArgs('quote', { fromToken: route.address, toToken: STABLES.USDT.address, qty }),
      swap: bawArgs('swap', { fromToken: route.address, toToken: STABLES.USDT.address, qty }),
    },
  };
}

// Read back an Agentic Wallet swap and count what arrived in real shares.
export async function agentVerify({ txHash, token, wallet, multiplier }) {
  const status = await tradeStatus(txHash);
  if (status.status !== 'success') return { verified: false, ...status };
  const received = status.transfers.filter(
    (t) => t.token?.toLowerCase() === token.toLowerCase() && (!wallet || t.to?.toLowerCase() === wallet.toLowerCase()),
  );
  const tokens = received.reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  return {
    verified: tokens > 0,
    ...status,
    received: { tokens, shares: multiplier ? round(tokens * multiplier, 9) : null },
  };
}
