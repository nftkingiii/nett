import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, pickReference } from './compare.js';

const tokens = [
  { symbol: 'GOOGLon', type: 1, address: '0x01', multiplier: '1.00246' },
  { symbol: 'GOOGLx', type: 2, address: '0x02', multiplier: '1.00193' },
  { symbol: 'GOOGLB', type: 3, address: '0x03', multiplier: '1.00048' },
];
const trading = { openState: true, reasonCode: 'TRADING' };

test('divides by the multiplier: a token is not one share', () => {
  const result = compare(
    [{ symbol: 'SPLITon', type: 1, address: '0x09', multiplier: '10' }],
    [{ tokenPrice: '1000', multiplier: '10', referencePrice: '100', status: trading }],
    { usd: 100 },
  );
  assert.equal(result.routes[0].perShare, 100);
  assert.equal(result.routes[0].premiumPct, 0);
  assert.equal(result.routes[0].sharesForUsd, 1);
});

test('buy prefers the cheapest real share, sell the dearest', () => {
  const snaps = [
    { tokenPrice: '344.55', multiplier: '1.00246', referencePrice: '343.705', status: trading },
    { tokenPrice: '342.00', multiplier: '1.00193', referencePrice: '343.705', status: trading },
    { tokenPrice: '343.70', multiplier: '1.00048', referencePrice: null, status: trading },
  ];
  assert.equal(compare(tokens, snaps, { usd: 10 }).best, 'GOOGLx');
  assert.equal(compare(tokens, snaps, { usd: 10, side: 'sell' }).best, 'GOOGLon');
});

test('refuses a halted token even when it is the cheapest', () => {
  const snaps = [
    { tokenPrice: '344.55', multiplier: '1.00246', referencePrice: '343.705', status: trading },
    { tokenPrice: '300.00', multiplier: '1', referencePrice: '343.705', status: { openState: true, reasonCode: 'SPLIT', reasonMsg: 'Stock split in progress' } },
    { tokenPrice: '343.70', multiplier: '1.00048', referencePrice: '343.705', status: trading },
  ];
  const result = compare(tokens, snaps, { usd: 10 });
  const halted = result.routes.find((r) => r.symbol === 'GOOGLx');
  assert.equal(halted.verdict, 'blocked');
  assert.equal(halted.reasons[0].message, 'Stock split in progress');
  assert.equal(result.routes.at(-1).symbol, 'GOOGLx');
  assert.equal(result.best, 'GOOGLB');
});

test('refuses a wrapper that has drifted too far from the stock', () => {
  const snaps = [
    { tokenPrice: '100', multiplier: '1', referencePrice: '100', status: trading },
    { tokenPrice: '95', multiplier: '1', referencePrice: '100', status: trading },
    { tokenPrice: '101.5', multiplier: '1', referencePrice: '100', status: trading },
  ];
  const result = compare(tokens, snaps, { usd: 10 });
  assert.equal(result.routes.find((r) => r.symbol === 'GOOGLx').verdict, 'blocked');
  assert.equal(result.routes.find((r) => r.symbol === 'GOOGLB').verdict, 'caution');
  assert.equal(result.best, 'GOOGLon');
});

test('warns that RFQ providers may refuse orders while the US market is closed', () => {
  const snaps = tokens.map(() => ({ tokenPrice: '100', multiplier: '1', referencePrice: '100', status: trading }));
  const session = { openState: false, reasonMsg: 'Weekend or Holiday' };
  const result = compare(tokens, snaps, { usd: 10, session });
  const codes = (sym) => result.routes.find((r) => r.symbol === sym).reasons.map((r) => r.code);
  assert.ok(codes('GOOGLon').includes('market_closed'));
  assert.ok(codes('GOOGLB').includes('market_closed'));
  assert.ok(!codes('GOOGLx').includes('market_closed'));
});

test('reference follows the majority when one feed disagrees', () => {
  assert.equal(pickReference([{ referencePrice: '10' }, { referencePrice: '12' }, { referencePrice: '12' }]), 12);
  assert.equal(pickReference([{ referencePrice: null }]), null);
});

test('edge is the gap between best and worst eligible routes, on either side', () => {
  const snaps = [
    { tokenPrice: '100', multiplier: '1', referencePrice: '100', status: trading },
    { tokenPrice: '99', multiplier: '1', referencePrice: '100', status: trading },
    { tokenPrice: '200', multiplier: '1', referencePrice: '100', status: trading },
  ];
  const buy = compare(tokens, snaps, { usd: 100 });
  const sell = compare(tokens, snaps, { usd: 100, side: 'sell' });
  assert.equal(buy.best, 'GOOGLx');
  assert.ok(Math.abs(buy.edgePct - 1) < 1e-9);
  assert.equal(sell.best, 'GOOGLon');
  assert.ok(Math.abs(sell.edgeUsd - 1.0101) < 1e-3);
});

test('a closed-market reference is a note, not a warning', () => {
  const snaps = [{ tokenPrice: '100', multiplier: '1', referencePrice: '100', status: trading }];
  const result = compare([tokens[1]], snaps, { usd: 10, session: { openState: false } });
  assert.equal(result.routes[0].verdict, 'ok');
  assert.equal(result.routes[0].reasons[0].severity, 'info');
});

test('an executable quote replaces the listed price; a failed quote refuses the route', () => {
  const snaps = [
    { tokenPrice: '344.55', multiplier: '1.00246', referencePrice: '343.705', status: trading },
    { tokenPrice: '339.00', multiplier: '1.00193', referencePrice: '343.705', status: trading },
    { tokenPrice: '343.70', multiplier: '1.00048', referencePrice: '343.705', status: trading },
  ];
  const quotes = [
    { tokensOut: 0.028760256, executionMode: 'SWAP', vendorName: 'LiquidMesh', hops: 1 },
    { error: { code: 40374, message: 'Insufficient liquidity' } },
    { tokensOut: 0.029103821, executionMode: 'SWAP', vendorName: 'LiquidMesh', hops: 4 },
  ];
  const result = compare(tokens, snaps, { usd: 10, quotes, reference: { price: 343.705, source: 'test' } });
  const x = result.routes.find((r) => r.symbol === 'GOOGLx');
  assert.equal(x.verdict, 'blocked');
  assert.equal(x.reasons[0].code, 'no_liquidity');
  const on = result.routes.find((r) => r.symbol === 'GOOGLon');
  assert.equal(on.priceBasis, 'quote');
  assert.ok(Math.abs(on.perShare - 10 / (0.028760256 * 1.00246)) < 1e-9);
  assert.equal(result.best, 'GOOGLB');
  assert.equal(result.referenceSource, 'test');
});

test('no eligible route means no pick', () => {
  const snaps = tokens.map(() => ({ tokenPrice: null, multiplier: '1', referencePrice: '100', status: trading }));
  assert.equal(compare(tokens, snaps, { usd: 10 }).best, null);
});
