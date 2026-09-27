# Nett

**Buy the share, not the wrapper.**

The same US stock trades on BNB Smart Chain as up to three different tokens — Ondo (`…on`), xStocks (`…x`) and bStock (`…B`). Each has its own price, share multiplier, trading hours, liquidity and execution path. Nett resolves a stock to every version, prices each one by what your money actually buys, refuses the versions that are unsafe, and lets you buy the best one from your own wallet.

## What it does

- **Counts real shares.** Every token price is divided by its share multiplier before comparison.
- **Prices what the money buys.** Each version is quoted through the Binance Web3 Trading API for the exact amount; listed prices are shown only as context.
- **Refuses what cannot be bought or no longer tracks the stock.** No liquidity, issuer closed outside US hours, corporate-action halt, or more than 3% from the underlying price.
- **Checks again before you sign.** Buying re-runs every check for your wallet, approves exactly the amount spent, binds a fresh quote with slippage and price-impact caps, and simulates the transaction before the wallet asks you to confirm. Nett never holds keys.
- **Sells the same way.** From Holdings, sell 25%, 50% or all of a position back to USDT: Nett reads the balance, quotes the sale, refuses it if a real share would fetch more than 3% under the stock, approves exactly the tokens being sold and simulates before you sign.
- **Discover** lists every tokenized stock on BSC with its versions and the listed gap between issuers. **Holdings** counts a wallet's tokenized stocks in real shares.

## Binance Web3 API modules used

| Module | Endpoints | Used for |
|---|---|---|
| RWA Data | `rwa/tokens`, `rwa/underlying-market` | names, logos, share ratios, status, reference price |
| Trading | `aggregator/quote`, `aggregator/swap`, `aggregator/approve-transaction` | executable quotes, unsigned swap and exact-amount approval |
| Transaction | `pre-transaction/simulate` | dry-run of every approval and swap before signing |
| Wallet | `balance/all-token-balances-by-address`, `post-transaction/transaction-detail-by-txhash` | holdings and post-trade read-back |
| Agentic Wallet | `baw` CLI: `wallet status/settings/address`, `market-order quote/swap/list`, `limit-order buy` | agent execution within the wallet's own limits |

Public Binance wallet endpoints supply the xStocks list, which the official RWA list does not include.

## For AI agents: Binance Agentic Wallet

Nett decides; the Binance Agentic Wallet executes. The `nett` skill (`skills/nett/SKILL.md`) and the
`nett-agent` runner drive the official `baw` CLI with Nett's checks enforced in code.

```bash
npx skills add nftkingiii/nett                              # add the skill to your agent
npx -y github:nftkingiii/nett plan GOOGL 10                 # what Nett would buy, and what it refuses
npx -y github:nftkingiii/nett buy GOOGL 10                  # dry run: checks + Agentic Wallet quote
npx -y github:nftkingiii/nett buy GOOGL 10 --ack-no-audit --yes     # submit, poll, verify on-chain
npx -y github:nftkingiii/nett limit AAPL 10 320             # limit order at a *share* price
npx -y github:nftkingiii/nett sell GOOGL GOOGLB 100         # dry run: sell a holding back to USDT
```

A buy stops if the wallet is not connected or over its daily limit, if every version is refused, if the
plan's command targets anything but the checked token and amount, or if the Agentic Wallet's own quote
buys less stock than Nett's floor. Orders are polled to `FINISHED`/`FAILED` and the delivery is read
back and counted in real shares. Sells check the same way and stop if the Agentic Wallet's quote pays
more than 1% less USDT than Nett's. Agent endpoints: `/api/agent/plan`, `/api/agent/limit-plan`,
`/api/agent/sell-plan`, `/api/agent/verify`.

## Proof on BNB Smart Chain mainnet

| What | Evidence |
|---|---|
| Agentic Wallet buy via `nett-agent buy GOOGL 5` | 5 USDT → 0.014546257 GOOGLB (0.014553211 real shares of Alphabet), [tx 0xe87f…1670](https://bscscan.com/tx/0xe87f904965d2830cf7fb0cb35d918006b492e816c6e9cd0383c4cbe4dc3c1670), block 124297085, 27 Sep 2026 |
| Refused on the same run | GOOGLx: no liquidity for the amount (`40374`); GOOGLon: below the $5 minimum (`40375`) |
| Read-back | Binance Wallet API transaction detail plus a direct `balanceOf` read of the GOOGLB contract |

Demo video: *link added at submission*.

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

- Trades are capped at $50 while in preview; sells are 25%, 50% or 100% of a holding.
- Dealer-quote (RFQ) routes are refused rather than executed for now.
- Not investment advice. Tokenized stocks are not offered to US persons.

## License

MIT
