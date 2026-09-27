---
name: nett
description: |
  Buy the real share, not the wrapper. Use when a user wants to buy a US stock or ETF on BNB Smart Chain
  ("buy $10 of Apple", "get me some Nvidia on-chain", "buy Alphabet if it drops to $330") through the
  Binance Agentic Wallet. The same stock trades as up to three tokens (Ondo …on, xStocks …x, bStock …B)
  with different prices, share multipliers, hours and liquidity. Nett picks the version that buys the
  most real stock, refuses the unsafe ones with a reason, and turns share-price limit orders into the
  correct token trigger. Execution goes through the `binance-agentic-wallet` skill's `baw` CLI.
metadata:
  author: nftkingiii
  version: "0.1.0"
  requires:
    skills: [binance-agentic-wallet]
    bins: [node, baw]
---

# Nett — buy the real share through the Agentic Wallet

Nett is the decision layer; the Binance Agentic Wallet is the execution layer. Never buy a tokenized
stock by ticker alone: the cheapest-looking token is often the one that cannot be filled, and a token
is not always one share.

## When to use

- The user names a US stock or ETF and an amount to buy on BNB Chain.
- The user wants a limit order expressed as a **share** price ("when Apple is $320").
- The user asks which tokenized version (Ondo / xStocks / bStock) to buy.
- The user wants to sell part or all of a tokenized-stock holding back to USDT.

Not for: perps, or non-stock tokens (use `binance-agentic-wallet` directly).

## Preflight

1. Complete the `binance-agentic-wallet` preflight (skill version, `baw` version, `baw wallet status`).
   If the wallet is `UNCONNECTED`, stop and guide sign-in (`baw auth signin` → user confirms the pairing
   code in the Binance app → `baw auth verify`). Never ask for keys, seed phrases or passwords.
2. Node 22+ must be available to run `nett-agent`: `npx -y github:nftkingiii/nett <command>` runs it
   straight from GitHub (or `node scripts/nett-agent.js` inside a clone). Install this skill with
   `npx skills add nftkingiii/nett`.

## Buying — always through `nett-agent`

The runner enforces Nett's checks in code, so they do not depend on this prompt being followed.

```bash
nett-agent plan <TICKER> <USD>                    # what Nett would buy and what it refuses
nett-agent buy  <TICKER> <USD>                    # dry run: full checks + Agentic Wallet quote, no order
nett-agent buy  <TICKER> <USD> --ack-no-audit --yes   # submit, poll to a final state, verify on-chain
```

What `buy` does, in order — each step can stop the run:

1. Agentic Wallet connected; today's remaining limit covers the amount (max $50 per buy).
2. Nett plan (`GET /api/agent/plan`): every version is quoted for the exact amount through the Binance
   Trading API; versions with no liquidity, a closed issuer, a halt, or a price more than 3% from the
   stock are refused. The best remaining version is chosen by price per **real share**.
3. Provenance of the chosen contract (Binance RWA list or public wallet list) and the Binance token audit.
   The audit currently has **no data for tokenized stocks** — tell the user, and only continue with
   `--ack-no-audit` after they explicitly acknowledge it.
4. The plan's `baw` commands are checked to target exactly the chosen token, USDT, the amount and chain 56.
5. `baw market-order quote` must return at least Nett's floor (1% below Nett's expected tokens);
   otherwise the Agentic Wallet route is worse than the one Nett checked, and the run stops.
6. Only with `--yes`: `baw market-order swap` (slippage 1%), then `market-order list --orderId` is polled
   until `FINISHED` or `FAILED`. An `orderId` alone is never reported as success.
7. `GET /api/agent/verify` reads the transaction back through the Binance Wallet API and reports the
   tokens received **and the real shares** (tokens × multiplier). A receipt is written to `receipts/`.

## Limit orders by share price

Agentic Wallet limit orders trigger on the **token's** USD price. Nett converts:
`token trigger = share price × multiplier` for the version it chose.

```bash
nett-agent limit <TICKER> <USD> <SHARE_PRICE>                        # dry run
nett-agent limit <TICKER> <USD> <SHARE_PRICE> --ack-no-audit --yes   # place it
```

## Selling a holding

```bash
nett-agent sell <TICKER> <SYMBOL> <25|50|100>         # dry run: balance, quote, price check, wallet quote
nett-agent sell <TICKER> <SYMBOL> <25|50|100> --yes   # submit, poll to a final state, verify the USDT
```

Nett reads the holding from the contract, quotes the sale into USDT and refuses it if a real share would
fetch more than 3% under the stock, or if the Agentic Wallet's own quote pays more than 1% less USDT than
Nett's. The quantity is passed in tokens; if the wallet reads it as shares it sells slightly less, never more.

## Rules for the agent

- **Confirm before submitting.** Show the user the version, contract address, amount, expected real
  shares, per-share price vs the stock, the refused versions and why, and the audit status. Only add
  `--yes` after the user says yes to that exact summary. One confirmation covers one order.
- **Never override a refusal.** If Nett refuses every version, report the reasons; do not fall back to
  a direct `baw market-order swap` on another token.
- **Never reword a conditional order into an immediate one.** If a limit order fails, report the error.
- **Report terminal states only:** `FINISHED` with tx hash and real shares, or `FAILED`/still pending.
- Tokenized stocks are not offered to US persons; Nett is not investment advice.

## Without Node

Agents that cannot run the script may call the API directly and must apply steps 1–7 themselves:
`GET https://nett.up.railway.app/api/agent/plan?ticker=GOOGL&usd=10` returns `decision`, `chosen`,
`refused`, `guardrails` (including `minTokensFromWalletQuote`) and the exact `baw` argument arrays.
`/api/agent/limit-plan?...&sharePrice=` adds `target.tokenTriggerPrice`;
`/api/agent/sell-plan?ticker=&symbol=&percent=&wallet=` returns a checked sale with `minUsdtFromWalletQuote`;
`/api/agent/verify?txHash=&token=&wallet=&multiplier=` confirms delivery.
