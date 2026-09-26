import { useState } from 'react';

// Shared visual atoms: company and issuer marks.
export const PROVIDERS = {
  ondo: { name: 'Ondo', suffix: 'on', logo: 'https://public.bnbstatic.com/images/w3w/openapi/ondo.png' },
  xstocks: { name: 'xStocks', suffix: 'x', logo: null },
  bstock: { name: 'bStock', suffix: 'B', logo: 'https://public.bnbstatic.com/images/w3w/openapi/bstocks.png' },
};

export function CompanyMark({ logo, ticker, size = 40 }) {
  const [failed, setFailed] = useState(false);
  return logo && !failed ? (
    <img className="company-mark" src={logo} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <span className="company-mark is-text" style={{ width: size, height: size }} aria-hidden="true">
      {ticker?.slice(0, 2)}
    </span>
  );
}

export function IssuerMark({ provider, size = 22 }) {
  const p = PROVIDERS[provider];
  const [failed, setFailed] = useState(false);
  return p?.logo && !failed ? (
    <img className="issuer-mark" src={p.logo} alt={p.name} width={size} height={size} onError={() => setFailed(true)} />
  ) : (
    <span className="issuer-mark is-text" role="img" aria-label={p?.name ?? provider} style={{ width: size, height: size }}>
      {p?.suffix === 'x' ? 'x' : (p?.name ?? provider).slice(0, 1)}
    </span>
  );
}
