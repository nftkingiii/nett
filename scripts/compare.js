// Usage: npm run compare -- GOOGL 10 [buy|sell]
import { tokensForTicker, tokenSnapshot, marketStatus } from '../server/lib/rwa.js';
import { compare } from '../server/lib/compare.js';

const [ticker = 'GOOGL', usdArg = '10', side = 'buy'] = process.argv.slice(2);
const usd = Number(usdArg);

const tokens = await tokensForTicker(ticker);
if (tokens.length === 0) {
  console.error(`No tokenized version of ${ticker.toUpperCase()} found on BNB Smart Chain.`);
  process.exit(1);
}
const [session, ...snapshots] = await Promise.all([marketStatus(), ...tokens.map((t) => tokenSnapshot(t.address))]);
const result = compare(tokens, snapshots, { usd, side, session });

const pct = (v) => (v === null ? '   n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
console.log(`\n${ticker.toUpperCase()} · ${side} $${usd} · reference $${result.reference ?? 'n/a'} · US market ${session.marketStatus} (${session.reasonMsg ?? session.reasonCode})`);
console.log(`prices are ${result.priceBasis} (listed), not executable quotes\n`);
for (const r of result.routes) {
  const mark = r.symbol === result.best ? '→' : ' ';
  console.log(
    `${mark} ${r.symbol.padEnd(9)} ${r.providerName.padEnd(8)} ${r.execution.padEnd(8)} ` +
      `$${r.perShare?.toFixed(2) ?? 'n/a'}/share ${pct(r.premiumPct)}  ${r.sharesForUsd?.toFixed(6) ?? '-'} sh  ${r.verdict}`,
  );
  for (const reason of r.reasons) console.log(`    ${reason.severity}: ${reason.message}`);
}
if (result.edgePct !== null) {
  console.log(`\nbest vs worst eligible route: ${result.edgePct.toFixed(2)}% (≈ $${result.edgeUsd.toFixed(2)} on $${usd})`);
}
