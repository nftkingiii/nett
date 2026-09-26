// The three tokenized-stock issuers the Binance Web3 API distinguishes by `type`.
// Execution behaviour comes from the Trading API docs ("Equity Token Trading (RWA)"):
// Ondo is RFQ-only, xStocks trade in AMM pools, bStock can return an AMM and an RFQ route.
export const PROVIDERS = {
  1: {
    id: 'ondo',
    name: 'Ondo',
    suffix: 'on',
    execution: 'rfq',
    closedMarketError: 40367,
  },
  2: {
    id: 'xstocks',
    name: 'xStocks',
    suffix: 'x',
    execution: 'amm',
    closedMarketError: null,
  },
  3: {
    id: 'bstock',
    name: 'bStock',
    suffix: 'B',
    execution: 'amm+rfq',
    closedMarketError: 40369,
  },
};

export const BSC_CHAIN_ID = '56';

export const STABLES = {
  USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
};
