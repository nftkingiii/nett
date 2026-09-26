const RULES = [
  {
    title: 'Count real shares, not tokens',
    body: 'Each token stands for a number of shares set by its issuer — close to one, but it drifts with dividends and jumps with splits. Every price is divided by that multiplier before anything is compared.',
  },
  {
    title: 'Price what the money buys',
    body: 'Listed prices are not tradeable prices. Nett asks the Binance Trading API for a quote at your exact amount and uses what comes back, after routing, fees and price impact.',
  },
  {
    title: 'Refuse what cannot be bought',
    body: 'A version that returns no quote — not enough liquidity, or an issuer closed outside US hours — is refused, however cheap its listed price looks.',
  },
  {
    title: 'Refuse what has stopped tracking',
    body: 'More than 3% from the underlying stock and a version is refused; past 1% it is flagged. On weekends the reference is the last US close, so gaps widen.',
  },
  {
    title: 'Refuse halted stocks',
    body: 'Issuers pause tokens for splits, dividends and mergers. A paused version is refused with the issuer’s own reason.',
  },
  {
    title: 'Check again before you sign',
    body: 'When you buy, Nett re-runs every check for your wallet, approves exactly the amount you spend, and simulates the transaction before your wallet asks you to confirm.',
  },
];

export default function Rules() {
  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <h1 className="page-title">How Nett decides</h1>
          <p className="page-lede">Six rules, applied to every version of every stock, every time you compare.</p>
        </header>
        <ol className="rules">
          {RULES.map((r, i) => (
            <li key={r.title} className="rule">
              <span className="rule-n mono" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <h2>{r.title}</h2>
              <p>{r.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
