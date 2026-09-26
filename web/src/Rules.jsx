const RULES = [
  {
    title: 'Count real shares, not tokens',
    body: 'Each token stands for a number of shares set by its issuer — close to one, but it drifts with dividends and jumps with splits. Nett divides every price by that multiplier before comparing anything.',
  },
  {
    title: 'Price what the money buys',
    body: 'Listed prices are not tradeable prices. Nett asks the Binance Trading API for a quote at your exact amount and uses what comes back, after routing, fees and price impact.',
  },
  {
    title: 'Refuse what cannot be bought',
    body: 'If a version returns no quote — not enough liquidity, or its issuer is closed outside US hours — it is refused, however cheap its listed price looks.',
  },
  {
    title: 'Refuse what has stopped tracking the stock',
    body: 'A version priced more than 3% away from the underlying stock is refused; beyond 1% it is flagged. On weekends the reference is the last US close, so gaps are expected to widen.',
  },
  {
    title: 'Refuse halted stocks',
    body: 'Issuers pause tokens for splits, dividends and mergers. A paused version is refused with the issuer’s own reason.',
  },
];

export default function Rules() {
  return (
    <div className="rules">
      <h1 className="headline">How Nett decides</h1>
      <ol className="rule-list">
        {RULES.map((r, i) => (
          <li key={r.title}>
            <span className="rule-n" aria-hidden="true">{i + 1}</span>
            <div>
              <h2>{r.title}</h2>
              <p>{r.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="fineprint">
        Among the versions that pass, Nett picks the lowest price per real share when buying. It never picks for you
        silently: every refused version stays on screen with its reason.
      </p>
    </div>
  );
}
