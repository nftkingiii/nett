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

export const fetchHealth = () => getJson('/api/health');
export const fetchStocks = () => getJson('/api/stocks').then((b) => b.stocks);
export const fetchComparison = ({ ticker, usd }) =>
  getJson(`/api/compare?ticker=${encodeURIComponent(ticker)}&usd=${encodeURIComponent(usd)}&side=buy`);
