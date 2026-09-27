#!/usr/bin/env node
// nett-agent: buy the real share through the Binance Agentic Wallet, with Nett's checks enforced in code.
//
//   nett-agent preflight
//   nett-agent plan  <TICKER> <USD>
//   nett-agent buy   <TICKER> <USD>               [--yes] [--ack-no-audit]
//   nett-agent limit <TICKER> <USD> <SHARE_PRICE> [--yes] [--ack-no-audit]
//   nett-agent order <ORDER_ID>
//
// Without --yes nothing is submitted: the run stops after showing what would happen.
// Every wallet action goes through the official `baw` CLI (npm @binance/agentic-wallet).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const API = (process.env.NETT_API ?? 'https://nett.up.railway.app').replace(/\/$/, '');
const AUDIT_URL = 'https://web3.binance.com/bapi/defi/v1/public/wallet-direct/security/token/audit';
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [command, ...rest] = argv.filter((a) => !a.startsWith('--'));

class Stop extends Error {
  constructor(message, code = 2) {
    super(message);
    this.exitCode = code;
  }
}

const say = (msg = '') => console.log(msg);

// ---- baw ----------------------------------------------------------------------------------
// Run baw's own JS entry with this Node binary, so no shell is involved on any platform.
function bawCommand() {
  const candidates = [
    process.env.BAW_JS,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@binance', 'agentic-wallet', 'dist', 'index.js'),
    process.env.npm_config_prefix && path.join(process.env.npm_config_prefix, 'lib', 'node_modules', '@binance', 'agentic-wallet', 'dist', 'index.js'),
  ].filter(Boolean);
  const js = candidates.find((c) => existsSync(c));
  return js ? [process.execPath, [js]] : ['baw', []];
}

function baw(args, { timeoutMs = 60_000 } = {}) {
  // Every argument is built here from validated tickers, numbers and hex addresses.
  for (const a of args) if (!/^[A-Za-z0-9.\-_]+$/.test(a)) throw new Stop(`Refusing unsafe baw argument: ${a}`);
  const [file, pre] = bawCommand();
  return new Promise((resolve, reject) => {
    execFile(file, [...pre, ...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        return reject(new Stop(err?.code === 'ENOENT' ? 'The baw CLI is not installed: npm install -g @binance/agentic-wallet' : `baw returned no JSON for "${args.slice(0, 2).join(' ')}"`));
      }
      if (json.success === false) return reject(new Stop(`baw ${args.slice(0, 2).join(' ')} failed: ${json.error?.name ?? ''} ${json.error?.message ?? ''}`.trim()));
      resolve(json.data);
    });
  });
}

// ---- Nett API ------------------------------------------------------------------------------
async function nett(path) {
  const res = await fetch(API + path, { signal: AbortSignal.timeout(60_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Stop(`Nett ${path.split('?')[0]} failed: ${body.error ?? res.status}`);
  return body;
}

async function audit(address) {
  try {
    const res = await fetch(AUDIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', source: 'agent', 'Accept-Encoding': 'identity', 'User-Agent': 'nett-agent/0.1' },
      body: JSON.stringify({ binanceChainId: '56', contractAddress: address, requestId: randomUUID() }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    const d = body.data ?? {};
    if (!d.hasResult || !d.isSupported) return { available: false };
    const hits = (d.riskItems ?? []).flatMap((i) => i.details.filter((x) => x.isHit).map((x) => `${x.riskType}: ${x.title}`));
    return { available: true, level: d.riskLevel, levelEnum: d.riskLevelEnum, hits, tax: d.extraInfo };
  } catch {
    return { available: false, failed: true };
  }
}

// ---- checks shared by buy and limit ---------------------------------------------------------
async function preflight({ usd = 0, quiet = false } = {}) {
  const status = await baw(['wallet', 'status', '--json']);
  if (status.status !== 'CONNECTED') {
    throw new Stop('The Agentic Wallet is not signed in. Run `baw auth signin --json`, confirm the pairing code in the Binance app, then `baw auth verify --qrCodeId <id> --json`.');
  }
  const [settings, address] = await Promise.all([baw(['wallet', 'settings', '--json']), baw(['wallet', 'address', '--json'])]);
  const wallet = address?.addresses?.find((a) => a.binanceChainId === '56')?.address ?? null;
  if (!quiet) {
    say(`Agentic Wallet ${wallet ?? '(address unavailable)'} · connected`);
    say(`Daily limit $${settings.dailyLimit} · left today $${settings.quotaLeft} · session ends ${settings.sessionExpireTime}`);
    say(`Abnormal transactions: ${settings.abnormalTxnHandling} · trade all tokens: ${settings.tradeAllTokens}`);
  }
  if (usd && Number(settings.quotaLeft) < usd) throw new Stop(`Only $${settings.quotaLeft} of today's Agentic Wallet limit is left; this needs $${usd}.`);
  return { settings, wallet };
}

async function vetToken(plan) {
  const { chosen } = plan;
  const a = await audit(chosen.address);
  const p = chosen.provenance;
  say(`Provenance: ${chosen.symbol} ${chosen.address} · issuer ${p.issuer} · listed by ${p.listedBy}${p.status ? ` · ${p.status}` : ''}`);
  if (a.available) {
    say(`Binance token audit: ${a.levelEnum} (${a.level})${a.hits.length ? ` · ${a.hits.join('; ')}` : ''}`);
    if (a.level >= 4) throw new Stop(`Binance's token audit rates ${chosen.symbol} ${a.levelEnum}; not buying.`);
  } else {
    say(a.failed ? 'Binance token audit is temporarily unavailable.' : 'Binance token audit has no data for this token (tokenized stocks are not covered).');
    if (!flags.has('--ack-no-audit')) throw new Stop('Re-run with --ack-no-audit to acknowledge buying without a token audit.', 3);
    say('Acknowledged: proceeding without a token audit (--ack-no-audit).');
  }
}

const USDT = '0x55d398326f99059fF775485246999027B3197955';

// The commands in a plan come from Nett's server; confirm they buy exactly what was checked.
function checkCommand(args, plan, usd) {
  const at = (name) => args[args.indexOf(name) + 1];
  if (at('--toToken')?.toLowerCase() !== plan.chosen.address.toLowerCase()) throw new Stop('Plan command targets a different token than Nett chose.');
  if (at('--fromToken')?.toLowerCase() !== USDT.toLowerCase()) throw new Stop('Plan command does not spend USDT.');
  if (Number(at('--fromTokenQty')) !== usd) throw new Stop('Plan command spends a different amount.');
  if (at('--binanceChainId') !== '56') throw new Stop('Plan command is not for BNB Smart Chain.');
}

function checkPlan(plan) {
  if (plan.decision === 'refuse') {
    say(`Nett refuses: ${plan.reason}`);
    for (const r of plan.refused ?? []) say(`  ${r.symbol}: ${r.reasons.join(' ')}`);
    throw new Stop('No version passed Nett’s checks.', 2);
  }
  const c = plan.chosen;
  say(`Nett picks ${c.symbol} (${c.issuer}) · $${c.perShare}/real share · ${c.premiumPct >= 0 ? '+' : ''}${c.premiumPct}% vs stock $${plan.reference.price}`);
  for (const w of c.warnings) say(`  caution: ${w}`);
  for (const r of plan.refused) say(`  refused ${r.symbol}: ${r.reasons.join(' ')}`);
}

async function receipt(kind, data) {
  await mkdir('receipts', { recursive: true });
  const file = `receipts/${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}.json`;
  await writeFile(file, JSON.stringify(data, null, 2));
  return file;
}

// ---- commands -------------------------------------------------------------------------------
const num = (v, name, max) => {
  const n = Number(v);
  if (!(n > 0) || (max && n > max)) throw new Stop(`${name} must be a number${max ? ` up to ${max}` : ''}.`);
  return n;
};
const tick = (v) => {
  const t = String(v ?? '').toUpperCase();
  if (!/^[A-Z0-9.]{1,12}$/.test(t)) throw new Stop('Give a stock ticker, e.g. GOOGL.');
  return t;
};

async function buy(tickerArg, usdArg) {
  const ticker = tick(tickerArg);
  const usd = num(usdArg, 'USD amount', 50);
  const { wallet } = await preflight({ usd });
  const plan = await nett(`/api/agent/plan?ticker=${ticker}&usd=${usd}`);
  checkPlan(plan);
  await vetToken(plan);

  checkCommand(plan.baw.quote, plan, usd);
  checkCommand(plan.baw.swap, plan, usd);
  // The Agentic Wallet's own route must buy at least as much stock as Nett's check allowed.
  const q = await baw(plan.baw.quote);
  const walletTokens = Number(q.toCoinAmount);
  const floor = plan.guardrails.minTokensFromWalletQuote;
  const walletPerShare = usd / (walletTokens * plan.chosen.multiplier);
  say(`Agentic Wallet quote: ${walletTokens} ${plan.chosen.symbol} → $${walletPerShare.toFixed(4)}/real share (Nett floor ${floor})`);
  if (!(walletTokens >= floor)) {
    throw new Stop(`The Agentic Wallet route buys ${walletTokens}, below Nett's floor of ${floor}. Not buying.`);
  }
  if (Date.now() > Date.parse(plan.expiresAt)) throw new Stop('The plan expired while checking; run again.');

  if (!flags.has('--yes')) {
    say(`\nDry run. To buy: spend ${usd} USDT for ≈${walletTokens} ${plan.chosen.symbol} (${(walletTokens * plan.chosen.multiplier).toFixed(6)} real shares of ${ticker}), slippage ${plan.guardrails.slippagePercent}%.`);
    say('Re-run with --yes to submit through the Agentic Wallet.');
    return;
  }

  const submitted = await baw(plan.baw.swap);
  say(`Submitted order ${submitted.orderId}; waiting for a final state…`);
  const order = await pollOrder(submitted.orderId);
  const out = { kind: 'market-buy', ticker, usd, wallet, plan, walletQuote: q, order };
  if (order.status !== 'FINISHED') {
    out.file = await receipt('failed', out);
    throw new Stop(`Order ${submitted.orderId} ended ${order.status}${order.txHash ? ` (tx ${order.txHash})` : ''}. Receipt: ${out.file}`, 4);
  }
  say(`Order FINISHED · tx ${order.txHash}`);
  const verify = await nett(`/api/agent/verify?txHash=${order.txHash}&token=${plan.chosen.address}${wallet ? `&wallet=${wallet}` : ''}&multiplier=${plan.chosen.multiplier}`);
  out.verify = verify;
  const file = await receipt('buy', out);
  if (verify.verified) say(`Verified on-chain: ${verify.received.tokens} ${plan.chosen.symbol} = ${verify.received.shares} real shares of ${ticker}. Receipt: ${file}`);
  else say(`Order finished but Nett could not confirm the transfer yet (${verify.status}). Receipt: ${file}`);
}

async function pollOrder(orderId, { timeoutMs = 120_000 } = {}) {
  if (!/^[0-9A-Za-z-]+$/.test(String(orderId))) throw new Stop('Unexpected order id from baw.');
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    const data = await baw(['market-order', 'list', '--orderId', String(orderId), '--json']);
    last = data?.list?.[0] ?? null;
    if (last && (last.status === 'FINISHED' || last.status === 'FAILED')) return last;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return last ?? { status: 'PENDING' };
}

async function limit(tickerArg, usdArg, shareArg) {
  const ticker = tick(tickerArg);
  const usd = num(usdArg, 'USD amount', 50);
  const sharePrice = num(shareArg, 'Share price');
  await preflight({ usd });
  const plan = await nett(`/api/agent/limit-plan?ticker=${ticker}&usd=${usd}&sharePrice=${sharePrice}`);
  checkPlan(plan);
  await vetToken(plan);
  checkCommand(plan.baw.limit, plan, usd);
  const trigger = Number(plan.baw.limit[plan.baw.limit.indexOf('--triggerPrice') + 1]);
  if (Math.abs(trigger - sharePrice * plan.chosen.multiplier) > 1e-4 * trigger) throw new Stop('Plan trigger price does not match share price × multiplier.');
  say(plan.note);
  say(`Target: $${sharePrice}/share (${plan.target.vsReferencePct}% vs the stock) → token trigger $${plan.target.tokenTriggerPrice}`);
  if (!flags.has('--yes')) {
    say('Dry run. Re-run with --yes to place the limit order through the Agentic Wallet.');
    return;
  }
  const placed = await baw(plan.baw.limit);
  const file = await receipt('limit', { kind: 'limit-buy', ticker, usd, sharePrice, plan, placed });
  say(`Limit order placed · strategy ${placed.strategyId}. Check it with: baw limit-order list --strategyId ${placed.strategyId} --json. Receipt: ${file}`);
}

async function main() {
  if (command === 'preflight') return void (await preflight());
  if (command === 'plan') {
    const plan = await nett(`/api/agent/plan?ticker=${tick(rest[0])}&usd=${num(rest[1] ?? 10, 'USD amount', 50)}`);
    return checkPlan(plan);
  }
  if (command === 'buy') return buy(rest[0], rest[1]);
  if (command === 'limit') return limit(rest[0], rest[1], rest[2]);
  if (command === 'order') return say(JSON.stringify(await pollOrder(rest[0], { timeoutMs: 1 }), null, 2));
  say('Usage: nett-agent preflight | plan <TICKER> <USD> | buy <TICKER> <USD> [--yes] [--ack-no-audit] | limit <TICKER> <USD> <SHARE_PRICE> [--yes] [--ack-no-audit] | order <ID>');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Stop ? err.message : `Unexpected error: ${err.message}`);
  process.exitCode = err.exitCode ?? 1;
});
