// Usage: npm run compare -- GOOGL 10 [buy|sell]
import { buildComparison } from '../server/lib/nett.js';

const [ticker = 'GOOGL', usdArg = '10', side = 'buy'] = process.argv.slice(2);
const usd = Number(usdArg);
const result = await buildComparison({ ticker, usd, side });
if (result.notFound) {
  console.error(`No tokenized version of ${result.ticker} found on BNB Smart Chain.`);
  process.exit(1);
}

const pct = (v) => (v === null ? '   n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const s = result.session;
console.log(`\n${result.ticker} · ${side} $${usd} · reference $${result.reference ?? 'n/a'} (${result.referenceSource})`);
console.log(`US market ${s?.marketStatus} (${s?.reasonMsg ?? s?.reasonCode}) · prices: ${result.mode}\n`);
for (const r of result.routes) {
  const mark = r.symbol === result.best ? '→' : ' ';
  const how = r.execution ? `${r.execution.mode}/${r.execution.hops}hop` : r.priceBasis;
  console.log(
    `${mark} ${r.symbol.padEnd(9)} ${r.providerName.padEnd(8)} ${how.padEnd(12)} ` +
      `$${r.perShare?.toFixed(2) ?? 'n/a'}/share ${pct(r.premiumPct)}  ${r.sharesForUsd?.toFixed(6) ?? '-'} sh  ${r.verdict}`,
  );
  for (const reason of r.reasons) console.log(`    ${reason.severity}: ${reason.message}`);
}
if (result.edgePct !== null) {
  console.log(`\nbest vs worst eligible route: ${result.edgePct.toFixed(2)}% (≈ $${result.edgeUsd.toFixed(2)} on $${usd})`);
}
