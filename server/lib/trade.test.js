import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSale, formatUnits, isAddress, prepareSell, prepareTrade, tradeStatus, TradeError } from './trade.js';

test('recognises EVM addresses only', () => {
  assert.equal(isAddress('0xF977814e90dA44bFA03b6295A0616a897441aceC'), true);
  assert.equal(isAddress('0x123'), false);
  assert.equal(isAddress(undefined), false);
});

test('refuses to prepare without a wallet or outside the preview limit, before any network call', async () => {
  await assert.rejects(prepareTrade({ ticker: 'GOOGL', symbol: 'GOOGLB', usd: 10, wallet: 'nope' }), (e) => e instanceof TradeError && e.code === 'bad_wallet');
  await assert.rejects(prepareTrade({ ticker: 'GOOGL', symbol: 'GOOGLB', usd: 500, wallet: '0xF977814e90dA44bFA03b6295A0616a897441aceC' }), (e) => e.code === 'bad_amount');
});

test('rejects malformed transaction hashes', async () => {
  await assert.rejects(tradeStatus('0x123'), (e) => e.code === 'bad_hash');
});

test('a sale is judged per real share against the stock', () => {
  // 0.01 tokens × 1.0005 shares/token for $3.40 → $339.83 per share vs a $343 stock: −0.92%, ok.
  const ok = assessSale({ usdtOut: 3.4, tokens: 0.01, multiplier: 1.0005, reference: 343 });
  assert.equal(ok.verdict, 'ok');
  assert.ok(Math.abs(ok.perShare - 339.83) < 0.01);
  assert.equal(assessSale({ usdtOut: 3.36, tokens: 0.01, multiplier: 1, reference: 343 }).verdict, 'caution');
  assert.equal(assessSale({ usdtOut: 3.2, tokens: 0.01, multiplier: 1, reference: 343 }).verdict, 'blocked');
  // Selling above the stock is never refused for price.
  assert.equal(assessSale({ usdtOut: 3.8, tokens: 0.01, multiplier: 1, reference: 343 }).verdict, 'ok');
  assert.equal(assessSale({ usdtOut: 0, tokens: 0.01, multiplier: 1, reference: 343 }).verdict, 'blocked');
});

test('refuses to prepare a sale without a wallet or with an odd fraction, before any network call', async () => {
  await assert.rejects(prepareSell({ ticker: 'GOOGL', symbol: 'GOOGLB', percent: 100, wallet: 'nope' }), (e) => e.code === 'bad_wallet');
  await assert.rejects(prepareSell({ ticker: 'GOOGL', symbol: 'GOOGLB', percent: 33, wallet: '0xF977814e90dA44bFA03b6295A0616a897441aceC' }), (e) => e.code === 'bad_amount');
});

test('formats token units exactly, without float rounding', () => {
  assert.equal(formatUnits(14546257072186585n), '0.014546257072186585');
  assert.equal(formatUnits(10n ** 18n), '1');
  assert.equal(formatUnits(1500000000000000000n), '1.5');
  assert.equal(formatUnits(0n), '0');
});
