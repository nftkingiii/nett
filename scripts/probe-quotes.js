// Read-only probe of the Trading API: one quote per provider version of a ticker.
// Usage: npm run probe -- GOOGL 10 [walletAddress]
import { call, quote, hasCredentials } from '../server/lib/web3api.js';
import { tokensForTicker } from '../server/lib/rwa.js';
import { PROVIDERS, STABLES } from '../server/lib/providers.js';

if (!hasCredentials()) {
  console.error('Set WEB3_API_KEY and WEB3_SECRET_KEY in .env first.');
  process.exit(1);
}
const [ticker = 'GOOGL', usdArg = '10', wallet] = process.argv.slice(2);
// RFQ quotes need a receiver; without the user's wallet, use the public example address from the docs.
const userWalletAddress = wallet ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const amount = (BigInt(Math.round(Number(usdArg) * 100)) * 10n ** 16n).toString(); // USDT has 18 decimals on BSC

const timed = async (label, fn) => {
  const start = performance.now();
  try {
    const data = await fn();
    console.log(`\n✓ ${label} (${Math.round(performance.now() - start)} ms)`);
    console.log(JSON.stringify(data, null, 2).slice(0, 4000));
  } catch (err) {
    console.log(`\n✗ ${label} (${Math.round(performance.now() - start)} ms): ${err.message}`);
  }
};

await timed('supported chains', () => call('GET', '/api/v1/dex/aggregator/supported/chain'));
for (const t of await tokensForTicker(ticker)) {
  await timed(`quote ${usdArg} USDT → ${t.symbol} (${PROVIDERS[t.type].name})`, () =>
    quote({ fromTokenAddress: STABLES.USDT.address, toTokenAddress: t.address, amount, userWalletAddress }),
  );
}
