// Turns a comparison pick into a transaction the user's own wallet signs.
// Nett never holds keys: it builds unsigned calldata, simulates it, and reads back the result.
import { DEFAULT_POLICY } from './compare.js';
import { buildComparison, usdtUnits } from './nett.js';
import { STABLES } from './providers.js';
import { call } from './web3api.js';

const BSC_RPC = process.env.BSC_RPC_URL ?? 'https://bsc-dataseed.bnbchain.org';
export const TRADE_LIMITS = { maxUsd: 50, slippagePercent: '1', priceImpactProtectionPercent: '3' };

export const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

export class TradeError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

async function rpc(method, params) {
  const res = await fetch(BSC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(`BSC RPC ${method}: ${body.error.message}`);
  return body.result;
}

const pad = (address) => address.toLowerCase().replace(/^0x/, '').padStart(64, '0');

export async function erc20Allowance(token, owner, spender) {
  const result = await rpc('eth_call', [{ to: token, data: `0xdd62ed3e${pad(owner)}${pad(spender)}` }, 'latest']);
  return BigInt(result);
}

export async function erc20Balance(token, owner) {
  return BigInt(await rpc('eth_call', [{ to: token, data: `0x70a08231${pad(owner)}` }, 'latest']));
}

export async function simulate(tx) {
  const data = await call('POST', '/api/v1/dex/pre-transaction/simulate', {
    body: { binanceChainId: '56', evmTx: { from: tx.from, to: tx.to, value: tx.value ?? '0', data: tx.data } },
  });
  return {
    ok: String(data?.status ?? '').toLowerCase() === 'success',
    status: data?.status ?? 'unknown',
    failReason: data?.failReason ?? null,
    balanceChanges: data?.balanceChanges ?? [],
    allowanceChanges: data?.allowanceChanges ?? [],
  };
}

// Re-run the full comparison for this wallet and refuse unless the requested version still passes.
// Prices move; a pick shown a minute ago is not a pick now.
async function revalidate({ ticker, symbol, usd, wallet }) {
  const comparison = await buildComparison({ ticker, usd, side: 'buy', wallet });
  if (comparison.notFound) throw new TradeError('not_found', `${ticker} has no tokenized version on BNB Chain.`);
  const route = comparison.routes.find((r) => r.symbol === symbol);
  if (!route) throw new TradeError('unknown_version', `${symbol} is not a version of ${ticker}.`);
  if (route.verdict === 'blocked') {
    throw new TradeError('refused', `Nett refuses ${symbol} right now: ${route.reasons.find((r) => r.severity === 'block')?.message}`, route);
  }
  return { comparison, route };
}

export async function prepareTrade({ ticker, symbol, usd, wallet }) {
  if (!isAddress(wallet)) throw new TradeError('bad_wallet', 'Connect a wallet first.');
  if (!(usd >= 1 && usd <= TRADE_LIMITS.maxUsd)) {
    throw new TradeError('bad_amount', `Trades are limited to $1–$${TRADE_LIMITS.maxUsd} while Nett is in preview.`);
  }
  const { comparison, route } = await revalidate({ ticker, symbol, usd, wallet });
  const amount = usdtUnits(usd);
  const usdt = STABLES.USDT.address;

  const balance = await erc20Balance(usdt, wallet);
  if (balance < BigInt(amount)) {
    throw new TradeError('insufficient_usdt', `This wallet holds ${Number(balance) / 1e18} USDT; the trade needs ${usd}.`);
  }

  // Approval: exactly the trade amount, never unlimited.
  const approvals = await call('GET', '/api/v1/dex/aggregator/approve-transaction', {
    params: { binanceChainId: 56, tokenContractAddress: usdt, approveAmount: amount },
  });
  const approval = Array.isArray(approvals) ? approvals[0] : approvals;
  if (!approval?.dexContractAddress) throw new TradeError('no_spender', 'The Trading API returned no spender to approve.');
  const allowance = await erc20Allowance(usdt, wallet, approval.dexContractAddress);
  if (allowance < BigInt(amount)) {
    const tx = { from: wallet, to: usdt, data: approval.data, value: '0', gas: approval.gasLimit, gasPrice: approval.gasPrice };
    return {
      step: 'approve',
      ticker: comparison.ticker,
      symbol,
      usd,
      spender: approval.dexContractAddress,
      amount,
      tx,
      simulation: await simulate(tx),
    };
  }

  // Fresh quote, then the unsigned swap bound to it. quoteId lives ~30 s.
  const quotes = await call('GET', '/api/v1/dex/aggregator/quote', {
    params: { binanceChainId: 56, fromTokenAddress: usdt, toTokenAddress: route.address, amount, userWalletAddress: wallet },
  });
  const best = (Array.isArray(quotes) ? quotes : [quotes]).find((q) => q.isBest) ?? quotes[0];
  if (best.executionMode === 'RFQ') {
    throw new TradeError('rfq_unsupported', `${symbol} is only available through a dealer quote (RFQ) right now, which Nett cannot execute yet.`);
  }
  const swap = await call('GET', '/api/v1/dex/aggregator/swap', {
    params: {
      binanceChainId: 56,
      amount,
      fromTokenAddress: usdt,
      toTokenAddress: route.address,
      userWalletAddress: wallet,
      quoteId: best.quoteId,
      slippagePercent: TRADE_LIMITS.slippagePercent,
      priceImpactProtectionPercent: TRADE_LIMITS.priceImpactProtectionPercent,
    },
  });
  const tx = swap?.tx;
  if (!tx?.to || !tx?.data) throw new TradeError('no_tx', 'The Trading API did not return a transaction to sign.');
  if (tx.from && tx.from.toLowerCase() !== wallet.toLowerCase()) {
    throw new TradeError('sender_mismatch', 'The built transaction is for a different wallet.');
  }
  const decimals = Number(best.toToken?.decimal ?? 18);
  return {
    step: 'swap',
    ticker: comparison.ticker,
    symbol,
    usd,
    reference: comparison.reference,
    route: { provider: route.providerName, perShare: route.perShare, premiumPct: route.premiumPct, multiplier: route.multiplier },
    expectedTokens: Number(best.toTokenAmount) / 10 ** decimals,
    minTokens: tx.minReceiveAmount ? Number(tx.minReceiveAmount) / 10 ** decimals : null,
    slippagePercent: tx.slippagePercent ?? TRADE_LIMITS.slippagePercent,
    vendor: best.vendorName,
    hops: best.dexRouterList?.length ?? null,
    tx: {
      from: wallet,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? '0',
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
    },
    simulation: await simulate({ from: wallet, to: tx.to, value: tx.value ?? '0', data: tx.data }),
    preparedAt: new Date().toISOString(),
  };
}

// ---- Selling ---------------------------------------------------------------------------------

// A sale is judged by what each real share fetches against the stock. Selling far under the
// stock is the mirror image of buying far over it, so the same ±limit applies.
export function assessSale({ usdtOut, tokens, multiplier, reference, policy = DEFAULT_POLICY }) {
  const perShare = usdtOut > 0 && tokens > 0 && multiplier > 0 ? usdtOut / (tokens * multiplier) : null;
  const gapPct = perShare !== null && reference > 0 ? ((perShare - reference) / reference) * 100 : null;
  let verdict = perShare === null ? 'blocked' : 'ok';
  if (gapPct !== null && -gapPct > policy.maxPremiumPct) verdict = 'blocked';
  else if (gapPct !== null && -gapPct > policy.cautionPremiumPct) verdict = 'caution';
  return { perShare, gapPct, verdict };
}

const SELL_BLOCKS = new Set(['market_closed', 'not_trading', 'corporate_action', 'no_price']);

// Everything a sale must pass before anything is built: status, balance, a live quote, the price check.
// Shared by the web flow (prepareSell) and the Agentic Wallet plan (agentSellPlan).
export async function checkSale({ ticker, symbol, percent, wallet }) {
  if (!isAddress(wallet)) throw new TradeError('bad_wallet', 'Connect a wallet first.');
  if (![25, 50, 100].includes(percent)) throw new TradeError('bad_amount', 'Sell 25%, 50% or 100% of a holding.');

  // Status checks only: a listed price does not decide a sale, the executable quote below does.
  const comparison = await buildComparison({ ticker, usd: 0, side: 'sell' });
  if (comparison.notFound) throw new TradeError('not_found', `${ticker} has no tokenized version on BNB Chain.`);
  const route = comparison.routes.find((r) => r.symbol === symbol);
  if (!route) throw new TradeError('unknown_version', `${symbol} is not a version of ${ticker}.`);
  const stop = route.reasons.find((r) => r.severity === 'block' && SELL_BLOCKS.has(r.code));
  if (stop) throw new TradeError('refused', `Nett will not sell ${symbol} right now: ${stop.message}`, route);

  const held = await erc20Balance(route.address, wallet);
  const amount = percent === 100 ? held : (held * BigInt(percent)) / 100n;
  if (amount <= 0n) throw new TradeError('nothing_to_sell', `This wallet holds no ${symbol}.`);
  const tokens = Number(amount) / 1e18; // tokenized stocks on BSC use 18 decimals
  const usdt = STABLES.USDT.address;

  const quotes = await call('GET', '/api/v1/dex/aggregator/quote', {
    params: { binanceChainId: 56, fromTokenAddress: route.address, toTokenAddress: usdt, amount: amount.toString(), userWalletAddress: wallet },
  }).catch((err) => {
    const known = QUOTE_ERROR_TEXT[Number(err.code)];
    throw new TradeError('no_quote', known ? `${symbol}: ${known}` : `No quote to sell ${symbol}: ${err.message}`);
  });
  const best = (Array.isArray(quotes) ? quotes : [quotes]).find((q) => q.isBest) ?? quotes[0];
  if (best.executionMode === 'RFQ') {
    throw new TradeError('rfq_unsupported', `${symbol} can only be sold through a dealer quote (RFQ) right now, which Nett cannot execute yet.`);
  }
  const usdtOut = Number(best.toTokenAmount) / 10 ** Number(best.toToken?.decimal ?? 18);
  if (usdtOut > TRADE_LIMITS.maxUsd) {
    throw new TradeError('bad_amount', `This sale is worth about $${usdtOut.toFixed(2)}; preview trades are limited to $${TRADE_LIMITS.maxUsd}. Sell a smaller part.`);
  }
  const sale = assessSale({ usdtOut, tokens, multiplier: route.multiplier, reference: comparison.reference });
  if (sale.verdict === 'blocked') {
    throw new TradeError('refused', sale.perShare === null
      ? `No usable price to sell ${symbol}.`
      : `Selling now fetches $${sale.perShare.toFixed(2)} per real share, ${Math.abs(sale.gapPct).toFixed(2)}% under the stock; the limit is ${DEFAULT_POLICY.maxPremiumPct}%.`);
  }
  return { comparison, route, amount, tokens, best, usdtOut, sale };
}

// 18-decimal integer → exact decimal string (no float rounding), e.g. 14546257072186585n → "0.014546257072186585".
export function formatUnits(raw, decimals = 18) {
  const s = raw.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export async function prepareSell({ ticker, symbol, percent, wallet }) {
  const { comparison, route, amount, tokens, best, usdtOut, sale } = await checkSale({ ticker, symbol, percent, wallet });
  const usdt = STABLES.USDT.address;

  // Approval: exactly the tokens being sold, never unlimited.
  const approvals = await call('GET', '/api/v1/dex/aggregator/approve-transaction', {
    params: { binanceChainId: 56, tokenContractAddress: route.address, approveAmount: amount.toString() },
  });
  const approval = Array.isArray(approvals) ? approvals[0] : approvals;
  if (!approval?.dexContractAddress) throw new TradeError('no_spender', 'The Trading API returned no spender to approve.');
  const common = {
    side: 'sell',
    ticker: comparison.ticker,
    symbol,
    percent,
    tokens,
    shares: tokens * route.multiplier,
    reference: comparison.reference,
    route: { provider: route.providerName, perShare: sale.perShare, premiumPct: sale.gapPct, multiplier: route.multiplier },
    expectedUsdt: usdtOut,
  };
  if ((await erc20Allowance(route.address, wallet, approval.dexContractAddress)) < amount) {
    const tx = { from: wallet, to: route.address, data: approval.data, value: '0', gas: approval.gasLimit, gasPrice: approval.gasPrice };
    return { step: 'approve', ...common, spender: approval.dexContractAddress, amount: amount.toString(), tx, simulation: await simulate(tx) };
  }

  const swap = await call('GET', '/api/v1/dex/aggregator/swap', {
    params: {
      binanceChainId: 56,
      amount: amount.toString(),
      fromTokenAddress: route.address,
      toTokenAddress: usdt,
      userWalletAddress: wallet,
      quoteId: best.quoteId,
      slippagePercent: TRADE_LIMITS.slippagePercent,
      priceImpactProtectionPercent: TRADE_LIMITS.priceImpactProtectionPercent,
    },
  });
  const tx = swap?.tx;
  if (!tx?.to || !tx?.data) throw new TradeError('no_tx', 'The Trading API did not return a transaction to sign.');
  if (tx.from && tx.from.toLowerCase() !== wallet.toLowerCase()) throw new TradeError('sender_mismatch', 'The built transaction is for a different wallet.');
  return {
    step: 'swap',
    ...common,
    minUsdt: tx.minReceiveAmount ? Number(tx.minReceiveAmount) / 1e18 : null,
    slippagePercent: tx.slippagePercent ?? TRADE_LIMITS.slippagePercent,
    vendor: best.vendorName,
    hops: best.dexRouterList?.length ?? null,
    tx: { from: wallet, to: tx.to, data: tx.data, value: tx.value ?? '0', gas: tx.gas, gasPrice: tx.gasPrice, maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null },
    simulation: await simulate({ from: wallet, to: tx.to, value: tx.value ?? '0', data: tx.data }),
    preparedAt: new Date().toISOString(),
  };
}

const QUOTE_ERROR_TEXT = {
  40374: 'not enough liquidity to sell this amount right now.',
  40375: 'below this route’s minimum order ($5).',
  40367: 'Ondo is not taking orders outside US market hours.',
  40369: 'bStock is not taking orders outside US market hours.',
};

// Read back a transaction the wallet broadcast. Empty data means "not indexed yet".
export async function tradeStatus(txHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '')) throw new TradeError('bad_hash', 'Not a transaction hash.');
  const data = await call('GET', '/api/v1/dex/post-transaction/transaction-detail-by-txhash', {
    params: { binanceChainId: 56, txHash },
  });
  const detail = Array.isArray(data) ? data[0] : data;
  if (!detail) return { status: 'indexing', txHash };
  return {
    status: detail.txStatus ?? 'unknown',
    txHash,
    block: detail.height ?? null,
    fee: detail.txFee ?? null,
    transfers: (detail.tokenTransferDetails ?? []).map((t) => ({
      symbol: t.symbol ?? t.tokenSymbol ?? null,
      amount: t.amount ?? null,
      from: t.from ?? t.fromAddress ?? null,
      to: t.to ?? t.toAddress ?? null,
      token: t.tokenContractAddress ?? null,
    })),
  };
}
