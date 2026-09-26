import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAddress, prepareTrade, tradeStatus, TradeError } from './trade.js';

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
