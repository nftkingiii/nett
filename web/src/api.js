async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function prepareTrade(body) {
  const res = await fetch('/api/trade/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Could not prepare the trade (${res.status}).`);
  return json;
}

export const fetchTradeStatus = (txHash) => getJson(`/api/trade/status?txHash=${encodeURIComponent(txHash)}`);

export const fetchHealth = () => getJson('/api/health');
export const fetchStocks = () => getJson('/api/stocks').then((b) => b.stocks);
export const fetchComparison = ({ ticker, usd }) =>
  getJson(`/api/compare?ticker=${encodeURIComponent(ticker)}&usd=${encodeURIComponent(usd)}&side=buy`);

export const fetchHoldings = (address) => getJson(`/api/holdings?address=${encodeURIComponent(address)}`);
export const fetchShowcase = () => getJson('/api/showcase');
