#!/usr/bin/env node
// Records what every version of a set of multi-issuer stocks does right now: verdict, refusal codes,
// execution mode of the live quote, and whether Nett's web flow could execute the pick.
// Run it in different market sessions (weekend, US hours, overnight) and compare the files.
//
//   node --env-file=.env scripts/session-check.js [USD] [TICKER ...]
import { mkdir, writeFile } from 'node:fs/promises';
import { buildComparison } from '../server/lib/nett.js';

const [usdArg, ...tickerArgs] = process.argv.slice(2);
const usd = Number(usdArg ?? 10);
const tickers = tickerArgs.length ? tickerArgs : ['GOOGL', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META', 'QQQ', 'SPY', 'ORCL', 'AVGO'];

const at = new Date();
const rows = [];
for (const ticker of tickers) {
  try {
    const c = await buildComparison({ ticker, usd, side: 'buy' });
    if (c.notFound) {
      rows.push({ ticker, notFound: true });
      continue;
    }
    const best = c.routes.find((r) => r.symbol === c.best) ?? null;
    rows.push({
      ticker,
      mode: c.mode,
      session: c.session ? { open: c.session.openState !== false, reason: c.session.reasonCode ?? null } : null,
      reference: c.reference,
      best: c.best,
      // The web flow signs AMM swaps only; an RFQ pick would be refused at "Prepare trade".
      webExecutable: best ? best.execution?.mode !== 'RFQ' : false,
      routes: c.routes.map((r) => ({
        symbol: r.symbol,
        provider: r.provider,
        verdict: r.verdict,
        mode: r.execution?.mode ?? null,
        vendor: r.execution?.vendor ?? null,
        premiumPct: r.premiumPct === null ? null : Number(r.premiumPct.toFixed(3)),
        blocks: r.reasons.filter((x) => x.severity === 'block').map((x) => x.code),
        why: r.reasons.filter((x) => x.severity === 'block').map((x) => x.message),
      })),
    });
  } catch (err) {
    rows.push({ ticker, error: err.message });
  }
}

const line = (r) => {
  if (r.notFound) return `${r.ticker}: no BSC version`;
  if (r.error) return `${r.ticker}: error ${r.error}`;
  const versions = r.routes
    .map((v) => `${v.symbol} ${v.verdict}${v.mode ? `/${v.mode}` : ''}${v.blocks.length ? ` [${v.blocks.join(',')}]` : ''}`)
    .join(' · ');
  return `${r.ticker}: best ${r.best ?? 'none'}${r.best && !r.webExecutable ? ' (RFQ: web flow refuses)' : ''} | ${versions}`;
};

const summary = {
  at: at.toISOString(),
  usd,
  usMarketOpen: rows.find((r) => r.session)?.session?.open ?? null,
  tradable: rows.filter((r) => r.best).length,
  webExecutable: rows.filter((r) => r.best && r.webExecutable).length,
  total: rows.length,
};
console.log(`${summary.at} · $${usd} · US market ${summary.usMarketOpen ? 'open' : 'closed'} · ${summary.tradable}/${summary.total} have a pick · ${summary.webExecutable} executable in the web flow`);
for (const r of rows) console.log(line(r));

await mkdir('notes', { recursive: true });
const file = `notes/session-check-${at.toISOString().replace(/[:.]/g, '-')}.json`;
await writeFile(file, JSON.stringify({ summary, rows }, null, 2));
console.log(`Saved ${file}`);
