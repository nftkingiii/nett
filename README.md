# Nett

Buy the real share, not the wrapper.

The same US stock exists on BNB Smart Chain as up to three different tokens — Ondo (`…on`), xStocks (`…x`) and bStock (`…B`) — each with its own price, share multiplier, trading hours and execution path. Nett resolves a ticker to every version, converts each token price into a price per real share, checks it against the underlying stock and its trading status, refuses routes that are halted or have drifted from the stock, and ranks the rest.

## Try it

Requires Node 20+.

```bash
npm test
npm run compare -- GOOGL 10
npm run compare -- QQQ 25 sell
```

Prices shown by `compare` are listed on-chain prices (indicative). Executable quotes come from the Binance Web3 Trading API and need credentials in a local `.env` (see `.env.example`).

## Status

Work in progress for BNB Hack: Tokenized Stocks Edition.
