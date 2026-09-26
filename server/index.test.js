import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompareQuery } from './index.js';

const q = (s) => parseCompareQuery(new URLSearchParams(s));

test('accepts a normal request and normalises the ticker', () => {
  assert.deepEqual(q('ticker=googl&usd=10'), { ticker: 'GOOGL', usd: 10, side: 'buy' });
});

test('rejects bad tickers, amounts and sides', () => {
  assert.ok(q('ticker=../etc&usd=10').error);
  assert.ok(q('ticker=GOOGL&usd=0').error);
  assert.ok(q('ticker=GOOGL&usd=5000').error);
  assert.ok(q('ticker=GOOGL&usd=abc').error);
  assert.ok(q('ticker=GOOGL&usd=10&side=short').error);
});
