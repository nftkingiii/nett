import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchComparison, fetchStocks } from './api.js';
import { localDateTime, pct, shares, time, usd } from './format.js';

const QUICK = ['GOOGL', 'AAPL', 'NVDA', 'QQQ'];
const PROVIDER_LOGO = {
  ondo: 'https://public.bnbstatic.com/images/w3w/openapi/ondo.png',
  bstock: 'https://public.bnbstatic.com/images/w3w/openapi/bstocks.png',
};

export default function Compare() {
  const [stocks, setStocks] = useState([]);
  const [query, setQuery] = useState('Alphabet (GOOGL)');
  const [amount, setAmount] = useState('10');
  const [state, setState] = useState({ status: 'idle' });
  const requestId = useRef(0);

  useEffect(() => {
    fetchStocks().then(setStocks).catch(() => setStocks([]));
  }, []);

  const label = (s) => (s.name ? `${shortName(s.name)} (${s.ticker})` : s.ticker);
  const tickerFor = useMemo(() => {
    const map = new Map();
    for (const s of stocks) {
      map.set(label(s).toLowerCase(), s.ticker);
      map.set(s.ticker.toLowerCase(), s.ticker);
    }
    return (text) => map.get(text.trim().toLowerCase()) ?? /\(([A-Z0-9.]+)\)\s*$/.exec(text)?.[1] ?? text.trim().toUpperCase();
  }, [stocks]);

  const run = async (tickerOverride) => {
    const ticker = tickerOverride ?? tickerFor(query);
    const value = Number(amount);
    if (!ticker) return setState({ status: 'error', message: 'Choose a stock first.' });
    if (!(value >= 1 && value <= 1000)) return setState({ status: 'error', message: 'Enter an amount between $1 and $1,000.' });
    const id = ++requestId.current;
    setState((s) => ({ status: 'loading', previous: s.result }));
    try {
      const result = await fetchComparison({ ticker, usd: value });
      if (id === requestId.current) setState({ status: 'ready', result });
    } catch (err) {
      if (id !== requestId.current) return;
      const message =
        err.status === 404
          ? `${ticker} has no tokenized version on BNB Chain yet.`
          : err.status === 429
            ? 'That was a lot of comparisons. Wait a minute and try again.'
            : err.message;
      setState({ status: 'error', message });
    }
  };

  // First visit: show a real answer straight away instead of an empty form.
  useEffect(() => {
    run('GOOGL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickQuick = (ticker) => {
    const s = stocks.find((x) => x.ticker === ticker);
    setQuery(s ? label(s) : ticker);
    run(ticker);
  };

  const result = state.status === 'ready' ? state.result : state.previous;

  return (
    <div className="compare">
      <h1 className="headline">Buy the share, not the wrapper.</h1>
      <p className="lede">
        The same US stock trades on BNB Chain as up to three tokens. Nett prices each one by what your money actually
        buys, checks it against the real stock, and refuses the ones that are unsafe.
      </p>

      <form
        className="ticket"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <span className="ticket-word">Buy</span>
        <label className="field amount">
          <span className="visually-hidden">Amount in US dollars</span>
          <span className="prefix" aria-hidden="true">$</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <span className="ticket-word">of</span>
        <label className="field stock">
          <span className="visually-hidden">Stock</span>
          <input list="stock-options" value={query} onChange={(e) => setQuery(e.target.value)} onFocus={(e) => e.target.select()} />
          <datalist id="stock-options">
            {stocks.map((s) => (
              <option key={s.ticker} value={label(s)}>{`${s.versions.length} version${s.versions.length > 1 ? 's' : ''}`}</option>
            ))}
          </datalist>
        </label>
        <button className="primary" type="submit" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Comparing…' : 'Compare'}
        </button>
      </form>

      <div className="quick" aria-label="Popular stocks">
        {QUICK.map((t) => (
          <button key={t} type="button" className="chip" onClick={() => pickQuick(t)} disabled={state.status === 'loading'}>
            {t}
          </button>
        ))}
      </div>

      {state.status === 'error' && (
        <p className="notice is-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'loading' && !result && <ResultSkeleton />}
      {result && <Result result={result} stale={state.status === 'loading'} />}
    </div>
  );
}

function shortName(name) {
  return name.replace(/,?\s+(Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|plc|N\.?V\.?|Holding)\b.*$/i, '').trim();
}

function Result({ result, stale }) {
  const best = result.routes.find((r) => r.symbol === result.best);
  const refused = result.routes.filter((r) => r.verdict === 'blocked').length;
  const s = result.session;
  const closed = s && s.openState === false;

  return (
    <section className={`result${stale ? ' is-stale' : ''}`} aria-live="polite" aria-busy={stale}>
      <div className="context">
        <span className={`pill ${closed ? 'is-closed' : 'is-open'}`}>
          {closed ? `US market closed · opens ${localDateTime(s.nextOpenTime)}` : 'US market open'}
        </span>
        <span className="pill">{result.mode === 'executable' ? 'Live quotes' : 'Listed prices only'}</span>
        <span className="muted">Updated {time(result.at)}</span>
      </div>

      {best ? (
        <div className="verdict">
          <Badge route={best} large />
          <div>
            <h2 className="verdict-title">
              Buy <span className="sym">{best.symbol}</span>
            </h2>
            <p className="verdict-body">
              {usd(result.usd, 0)} gets <strong>{shares(best.sharesForUsd)}</strong> real shares of {result.ticker} at{' '}
              <strong>{usd(best.perShare)}</strong> each —{' '}
              {best.premiumPct === null ? 'no reference price to compare with' : `${describeGap(best.premiumPct)} the stock (${usd(result.reference)})`}.
            </p>
            {result.edgeUsd !== null && result.edgeUsd >= 0.005 && (
              <p className="verdict-edge">
                {usd(result.edgeUsd)} more stock than the worst version that could still be bought
                {refused > 0 ? `, and ${refused} ${refused === 1 ? 'version was' : 'versions were'} refused.` : '.'}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="verdict is-none">
          <h2 className="verdict-title">Don't buy right now</h2>
          <p className="verdict-body">
            Every version of {result.ticker} failed a check for {usd(result.usd, 0)}. The reasons are below; nothing here is safe to trade.
          </p>
        </div>
      )}

      <ol className="routes">
        {result.routes.map((r) => (
          <RouteRow key={r.symbol} route={r} isBest={r.symbol === result.best} usdAmount={result.usd} />
        ))}
      </ol>

      <p className="fineprint">
        Reference: {result.reference ? usd(result.reference) : 'unavailable'} from {result.referenceSource}. A token can
        represent more or less than one share; Nett divides by each token's share multiplier. Quotes are previews for{' '}
        {usd(result.usd, 0)} — nothing is bought on this screen.
      </p>
    </section>
  );
}

function describeGap(p) {
  if (Math.abs(p) < 0.005) return 'the same as';
  return `${pct(p).replace('+', '')} ${p > 0 ? 'above' : 'below'}`;
}

function RouteRow({ route: r, isBest, usdAmount }) {
  const blocked = r.verdict === 'blocked';
  const main = r.reasons.filter((x) => x.severity !== 'info');
  const how = r.execution
    ? `${r.execution.mode === 'RFQ' ? 'Dealer quote' : 'Pool swap'} · ${r.execution.hops} ${r.execution.hops === 1 ? 'hop' : 'hops'}`
    : blocked
      ? 'No quote'
      : 'Listed price';
  return (
    <li className={`route is-${r.verdict}${isBest ? ' is-best' : ''}`}>
      <div className="route-id">
        <Badge route={r} />
        <div>
          <div className="sym">{r.symbol}</div>
          <div className="muted small">{r.providerName} · {how}</div>
        </div>
      </div>
      <dl className="route-figures">
        <div>
          <dt>Per real share</dt>
          <dd>{blocked && !r.execution ? <s>{usd(r.perShare)}</s> : usd(r.perShare)}</dd>
        </div>
        <div>
          <dt>vs stock</dt>
          <dd className={gapClass(r.premiumPct)}>{pct(r.premiumPct)}</dd>
        </div>
        <div>
          <dt>{usd(usdAmount, 0)} buys</dt>
          <dd>{blocked ? '—' : shares(r.sharesForUsd)}</dd>
        </div>
      </dl>
      <div className="route-verdict">
        <span className={`state state-${r.verdict}`}>{isBest ? 'Best' : { ok: 'OK', caution: 'Caution', blocked: 'Refused' }[r.verdict]}</span>
        {main.length > 0 && (
          <ul className="reasons">
            {main.map((x) => (
              <li key={x.code + x.message}>{x.message}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function gapClass(p) {
  if (p === null) return '';
  if (Math.abs(p) > 3) return 'gap-bad';
  if (Math.abs(p) > 1) return 'gap-warn';
  return '';
}

function Badge({ route, large }) {
  const src = PROVIDER_LOGO[route.provider];
  const size = large ? 'badge lg' : 'badge';
  return src ? (
    <img className={size} src={src} alt={route.providerName} width={large ? 44 : 32} height={large ? 44 : 32} />
  ) : (
    <span className={`${size} mono`} role="img" aria-label={route.providerName}>
      x
    </span>
  );
}

function ResultSkeleton() {
  return (
    <section className="result" aria-busy="true" aria-label="Loading comparison">
      <div className="verdict skeleton" />
      <ol className="routes">
        {[0, 1, 2].map((i) => (
          <li key={i} className="route skeleton" />
        ))}
      </ol>
    </section>
  );
}
