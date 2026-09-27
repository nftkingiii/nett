import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bawArgs, bawSellQty, tokenTriggerPrice, agentPlan } from './agent.js';

test('a share-price target becomes a token trigger via the multiplier', () => {
  assert.equal(tokenTriggerPrice(330, 1.0004780589781075), 330.157759);
  assert.equal(tokenTriggerPrice(100, 10), 1000); // post-split token holding 10 shares
});

test('baw commands carry exactly the checked token, amount, chain and slippage cap', () => {
  const args = bawArgs('swap', { fromToken: '0xUSDT', toToken: '0xTOKEN', qty: 10 });
  const at = (k) => args[args.indexOf(k) + 1];
  assert.deepEqual(args.slice(0, 2), ['market-order', 'swap']);
  assert.equal(at('--toToken'), '0xTOKEN');
  assert.equal(at('--fromTokenQty'), '10');
  assert.equal(at('--binanceChainId'), '56');
  assert.equal(at('--slippage'), '1');
  assert.equal(args.at(-1), '--json');
  const limit = bawArgs('limit', { fromToken: '0xUSDT', toToken: '0xTOKEN', qty: 10, triggerPrice: 330.157759 });
  assert.equal(limit[limit.indexOf('--triggerPrice') + 1], '330.157759');
});

test('agent buys above the cap are refused before any network call', async () => {
  const plan = await agentPlan({ ticker: 'GOOGL', usd: 500 });
  assert.equal(plan.decision, 'refuse');
});

test('bStock sell quantities go to the Agentic Wallet in share terms, rounded down', () => {
  // The 27 Sep sale: 0.014546257072186585 GOOGLB tokens × 1.0004780589781075 shares/token.
  const q = bawSellQty(14546257072186585n, 1.0004780589781075, 'bstock');
  assert.equal(q.unit, 'shares');
  assert.ok(Number(q.qty) <= 0.014546257072186585 * 1.0004780589781075);
  assert.ok(Number(q.qty) > 0.01455321);
  // Unverified issuers keep the token count, which can only sell less.
  assert.deepEqual(bawSellQty(14546257072186585n, 1.25, 'ondo'), { qty: '0.014546257072186585', unit: 'tokens' });
});
