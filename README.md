# Nett

**Buy the share, not the wrapper.**

The same US stock trades on BNB Smart Chain as up to three different tokens — Ondo (`…on`), xStocks (`…x`) and bStock (`…B`). Each has its own price, share multiplier, trading hours, liquidity and execution path. Nett resolves a stock to every version, prices each one by what your money actually buys, refuses the versions that are unsafe, and lets you buy the best one from your own wallet.

## What it does

- **Counts real shares.** Every token price is divided by its share multiplier before comparison.
- **Prices what the money buys.** Each version is quoted through the Binance Web3 Trading API for the exact amount; listed prices are shown only as context.
- **Refuses what cannot be bought or no longer tracks the stock.** No liquidity, issuer closed outside US hours, corporate-action halt, or more than 3% from the underlying price.
- **Checks again before you sign.** Buying re-runs every check for your wallet, approves exactly the amount spent, binds a fresh quote with slippage and price-impact caps, and simulates the transaction before the wallet asks you to confirm. Nett never holds keys.
- **Discover** lists every tokenized stock on BSC with its versions and the listed gap between issuers. **Holdings** counts a wallet's tokenized stocks in real shares.

## Binance Web3 API modules used

| Module | Endpoints | Used for |
|---|---|---|
| RWA Data | `rwa/tokens`, `rwa/underlying-market` | names, logos, share ratios, status, reference price |
| Trading | `aggregator/quote`, `aggregator/swap`, `aggregator/approve-transaction` | executable quotes, unsigned swap and exact-amount approval |
| Transaction | `pre-transaction/simulate` | dry-run of every approval and swap before signing |
| Wallet | `balance/all-token-balances-by-address`, `post-transaction/transaction-detail-by-txhash` | holdings and post-trade read-back |

Public Binance wallet endpoints supply the xStocks list, which the official RWA list does not include.

## Run locally

Requires Node 22.9+.

```bash
npm install
cp .env.example .env   # add your Binance Web3 API key and secret
npm run build
npm start              # http://localhost:8787 (landing) and /app
npm test
```

`npm run compare -- GOOGL 10` prints a comparison in the terminal.

The Binance Web3 API checks both client and server location; host the server outside the restricted regions listed at <https://web3.binance.com/en/dev-docs/web3-api-prohibited-regions>.

## Limits

- Buy side only; trades are capped at $50 while in preview.
- Dealer-quote (RFQ) routes are refused rather than executed for now.
- Not investment advice. Tokenized stocks are not offered to US persons.

## License

MIT
