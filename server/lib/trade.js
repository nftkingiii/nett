// Turns a comparison pick into a transaction the user's own wallet signs.
// Nett never holds keys: it builds unsigned calldata, simulates it, and reads back the result.
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
