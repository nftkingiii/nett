// Shared visual atoms: company and issuer marks.
export const PROVIDERS = {
  ondo: { name: 'Ondo', suffix: 'on', logo: 'https://public.bnbstatic.com/images/w3w/openapi/ondo.png' },
  xstocks: { name: 'xStocks', suffix: 'x', logo: null },
  bstock: { name: 'bStock', suffix: 'B', logo: 'https://public.bnbstatic.com/images/w3w/openapi/bstocks.png' },
};

export function CompanyMark({ logo, ticker, size = 40 }) {
  return logo ? (
    <img className="company-mark" src={logo} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="company-mark is-text" style={{ width: size, height: size }} aria-hidden="true">
      {ticker?.slice(0, 2)}
    </span>
  );
}

export function IssuerMark({ provider, size = 22 }) {
  const p = PROVIDERS[provider];
  return p?.logo ? (
    <img className="issuer-mark" src={p.logo} alt={p.name} width={size} height={size} />
  ) : (
    <span className="issuer-mark is-text" role="img" aria-label={p?.name ?? provider} style={{ width: size, height: size }}>
      x
    </span>
  );
}
