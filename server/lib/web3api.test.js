import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildQuery, call, clockOffset, learnClockOffset, sign } from './web3api.js';

test('signs the documented pre-hash, including the /build prefix', () => {
  const timestamp = '2026-05-11T10:08:57.715Z';
  const pathWithQuery = '/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT';
  const expected = crypto
    .createHmac('sha256', 'secret')
    .update('2026-05-11T10:08:57.715ZGET/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT', 'utf8')
    .digest('base64');
  assert.equal(sign({ timestamp, method: 'get', pathWithQuery, secret: 'secret' }), expected);
});

test('learns the clock offset from a 40103 recv_window error', () => {
  const sentAt = Date.parse('2026-09-26T19:38:01.000Z');
  const ok = learnClockOffset('Timestamp outside recv_window. serverTime=2026-09-26T19:38:12.354672181Z', sentAt);
  assert.equal(ok, true);
  assert.equal(clockOffset(), 11_354);
  assert.equal(learnClockOffset('some other error', sentAt), false);
});

test('encodes spaces as %20 and drops empty params', () => {
  assert.equal(buildQuery({ symbol: 'ETH USDT', chainId: 1, userWalletAddress: undefined }), 'symbol=ETH%20USDT&chainId=1');
});

test('a 42900 rate-limit response is retried once', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const body = calls === 1 ? { code: 42900, msg: 'Rate limit exceeded' } : { code: 0, data: { ok: true } };
    return { status: 200, json: async () => body };
  };
  try {
    const env = { WEB3_API_KEY: 'k', WEB3_SECRET_KEY: 's' };
    const data = await call('GET', '/api/v1/test', { env, retryDelayMs: 1 });
    assert.deepEqual(data, { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
