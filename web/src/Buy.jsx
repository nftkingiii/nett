import { useEffect, useRef, useState } from 'react';
import { fetchComparison } from './api.js';
import { localDateTime, pct, shares, time, usd } from './format.js';
import { AlertIcon, ArrowRight, CheckIcon, StopIcon } from './icons.jsx';
import StockPicker, { shortName } from './StockPicker.jsx';
import Trade from './Trade.jsx';
import { CompanyMark, IssuerMark, PROVIDERS } from './ui.jsx';

const QUICK = ['GOOGL', 'AAPL', 'NVDA', 'QQQ', 'TSLA'];
const AXIS = 3; // ±% shown on the spread strip; matches the refusal limit

export default function Buy({ stocks, request, wallet, walletError, onConnect, onSwitchNetwork, switching }) {
  const [ticker, setTicker] = useState(request.ticker);
  const [amount, setAmount] = useState('10');
  const [state, setState] = useState({ status: 'idle' });
  const requestId = useRef(0);

  const run = async (t = ticker) => {
    const value = Number(amount);
    if (!(value >= 1 && value <= 1000)) return setState({ status: 'error', message: 'Enter an amount between $1 and $1,000.' });
    const id = ++requestId.current;
    setState((s) => ({ status: 'loading', previous: s.result ?? s.previous }));
    try {
      const result = await fetchComparison({ ticker: t, usd: value });
      if (id === requestId.current) setState({ status: 'ready', result });
    } catch (err) {
      if (id !== requestId.current) return;
      const message =
        err.status === 404 ? `${t} has no tokenized version on BNB Chain yet.`
        : err.status === 429 ? 'That was a lot of comparisons. Wait a minute and try again.'
        : err.message;
      setState((s) => ({ status: 'error', message, previous: s.previous ?? s.result }));
    }
  };

  // First visit, and whenever another tab opens a stock here: show a live answer immediately.
  useEffect(() => {
    setTicker(request.ticker);
    run(request.ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.nonce]);

  const pick = (t) => { setTicker(t); run(t); };
  const result = state.status === 'ready' ? state.result : state.previous;
  const refreshing = state.status === 'loading' && Boolean(result);
  const byTicker = (t) => stocks.find((s) => s.ticker === t);

  return (
    <>
      <div className="hero">
        <div className="wrap hero-inner">
          <h1 className="hero-title">
            Buy the share,
            <br />
            not the wrapper.
          </h1>
          <p className="hero-lede">
            The same US stock trades on BNB Chain as up to three different tokens. Nett prices each by what your money
            actually buys and refuses the ones that are unsafe.
          </p>

          <form className="ticket" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <span className="ticket-word">Buy</span>
            <label className="amount">
              <span className="visually-hidden">Amount in US dollars</span>
              <span className="amount-prefix" aria-hidden="true">$</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
            <span className="ticket-word">of</span>
            <StockPicker stocks={stocks} value={ticker} onChange={pick} />
            <button className="btn btn-accent ticket-go" type="submit" disabled={state.status === 'loading'}>
              {state.status === 'loading' ? 'Weighing…' : <>Compare <ArrowRight /></>}
            </button>
          </form>

          <div className="quick" aria-label="Popular stocks">
            {QUICK.map((t) => {
              const s = byTicker(t);
              return (
                <button key={t} type="button" className={`quick-chip${ticker === t ? ' is-on' : ''}`} onClick={() => pick(t)} disabled={state.status === 'loading'}>
                  <CompanyMark logo={s?.logo} ticker={t} size={20} />
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="wrap">
        {state.status === 'error' && (
          <p className="banner is-bad" role="alert">
            {state.message}{result ? ` Showing the last result for ${result.ticker}.` : ''}
          </p>
        )}
        {refreshing && <p className="refreshing" role="status">Re-weighing with fresh quotes…</p>}
        {state.status === 'loading' && !result && <Skeleton />}
        {result && (
          <Result result={result} stock={byTicker(result.ticker)} stale={state.status === 'loading'} wallet={wallet} walletError={walletError} onConnect={onConnect} onSwitchNetwork={onSwitchNetwork} switching={switching} />
        )}
      </div>
    </>
  );
}

function Result({ result, stock, stale, wallet, walletError, onConnect, onSwitchNetwork, switching }) {
  const [buying, setBuying] = useState(null);
  useEffect(() => setBuying(null), [result.ticker, result.usd, result.at]);
  const best = result.routes.find((r) => r.symbol === result.best);
  const s = result.session;
  const closed = s && s.openState === false;
  const name = shortName(stock?.name) || result.ticker;
  const buyingRoute = result.routes.find((r) => r.symbol === buying);

  return (
    <section className={`result${stale ? ' is-stale' : ''}`} aria-live="polite" aria-busy={stale}>
      <div className="meta-row">
        <span className={`meta ${closed ? 'is-warn' : 'is-good'}`}>
          <span className="dot" />
          {closed ? `US market closed · reopens ${localDateTime(s.nextOpenTime)}` : 'US market open'}
        </span>
        <span className="meta">{result.mode === 'executable' ? `Live quotes for ${usd(result.usd, 0)}` : 'Listed prices only'}</span>
        <span className="meta muted">Weighed at {time(result.at)}</span>
      </div>

      <div className="verdict-grid">
        <NetTag result={result} best={best} name={name} stock={stock} />
        <SpreadStrip result={result} name={name} />
      </div>

      <h2 className="section-title">Every version of {name}</h2>
      <ol className="versions">
        {result.routes.map((r) => (
          <VersionCard
            key={r.symbol}
            route={r}
            isBest={r.symbol === result.best}
            usdAmount={result.usd}
            canBuy={result.mode === 'executable' && r.verdict !== 'blocked' && result.usd <= 50}
            isBuying={buying === r.symbol}
            onBuy={() => setBuying(r.symbol)}
          />
        ))}
      </ol>

      {buyingRoute && (
        <Trade route={buyingRoute} ticker={result.ticker} amount={result.usd} wallet={wallet} walletError={walletError} onConnect={onConnect} onSwitchNetwork={onSwitchNetwork} switching={switching} onClose={() => setBuying(null)} />
      )}

      <p className="fineprint">
        Reference {result.reference ? usd(result.reference) : 'unavailable'} · {result.referenceSource}. A token can stand
        for more or less than one share, so Nett divides by each token's share multiplier. Quotes are previews;
        nothing is bought until you confirm in your wallet.
      </p>
    </section>
  );
}

function NetTag({ result, best, name, stock }) {
  if (!best) {
    return (
      <div className="net-tag is-none">
        <span className="tag-hole" aria-hidden="true" />
        <h2 className="tag-headline">Don't buy {name} right now.</h2>
        <p className="tag-note">Every version failed a check for {usd(result.usd, 0)}. The reasons are listed below.</p>
      </div>
    );
  }
  const refused = result.routes.filter((r) => r.verdict === 'blocked').length;
  return (
    <div className="net-tag">
      <span className="tag-hole" aria-hidden="true" />
      <div className="tag-top">
        <CompanyMark logo={stock?.logo} ticker={result.ticker} size={44} />
        <div>
          <h2 className="tag-headline">
            Buy <span className="mono">{best.symbol}</span>
          </h2>
          <p className="tag-sub"><IssuerMark provider={best.provider} size={16} /> {best.providerName} version of {name}</p>
        </div>
      </div>
      <div className="tag-weight">
        <span className="tag-weight-label">Net weight · {usd(result.usd, 0)}</span>
        <span className="tag-weight-value mono">{shares(best.sharesForUsd)}</span>
        <span className="tag-weight-unit">real shares of {result.ticker}</span>
      </div>
      <dl className="tag-facts">
        <div><dt>Per real share</dt><dd className="mono">{usd(best.perShare)}</dd></div>
        <div><dt>vs the stock</dt><dd className="mono">{pct(best.premiumPct)}</dd></div>
        <div>
          <dt>vs worst option</dt>
          <dd className="mono">{result.edgeUsd !== null ? `+${usd(result.edgeUsd)}` : '—'}</dd>
        </div>
      </dl>
      {refused > 0 && <p className="tag-note"><StopIcon /> {refused} {refused === 1 ? 'version' : 'versions'} refused — see below.</p>}
    </div>
  );
}

// Where each version sits against the stock's price, on one axis.
function SpreadStrip({ result, name }) {
  const pos = (p) => 50 + (Math.max(-AXIS, Math.min(AXIS, p)) / AXIS) * 46;
  const points = result.routes.filter((r) => r.premiumPct !== null);
  return (
    <figure className="strip">
      <figcaption>
        <span className="strip-title">Distance from the real stock</span>
        <span className="muted small">{name} {result.reference ? usd(result.reference) : ''} = 0</span>
      </figcaption>
      <div className="strip-axis" role="img" aria-label={points.map((r) => `${r.symbol} ${pct(r.premiumPct)}, ${r.verdict === 'blocked' ? 'refused' : r.verdict === 'caution' ? 'caution' : 'clean'}`).join('; ')}>
        <span className="strip-zone is-bad-left" />
        <span className="strip-zone is-warn-left" />
        <span className="strip-zone is-ok" />
        <span className="strip-zone is-warn-right" />
        <span className="strip-zone is-bad-right" />
        <span className="strip-zero" />
        {points.map((r, i) => (
          <span
            key={r.symbol}
            className={`strip-point is-${r.verdict}${Math.abs(r.premiumPct) > AXIS ? ' is-off' : ''}${pos(r.premiumPct) > 62 ? ' label-left' : ''}`}
            style={{ left: `${pos(r.premiumPct)}%`, '--row': i }}
          >
            <span className="strip-label mono">
              {r.symbol} {pct(r.premiumPct)}
              {Math.abs(r.premiumPct) > AXIS ? ' ›' : ''}
            </span>
          </span>
        ))}
      </div>
      <div className="strip-scale mono">
        <span>−{AXIS}%</span><span>−1%</span><span>0</span><span>+1%</span><span>+{AXIS}%</span>
      </div>
      <p className="strip-note">Inside ±1% is clean. Past ±{AXIS}% Nett refuses the version: it has stopped tracking the stock.</p>
    </figure>
  );
}

function VersionCard({ route: r, isBest, usdAmount, canBuy, isBuying, onBuy }) {
  const blocked = r.verdict === 'blocked';
  const main = r.reasons.filter((x) => x.severity !== 'info');
  const how = r.execution
    ? `${r.execution.mode === 'RFQ' ? 'Dealer quote' : 'Pool swap'} · ${r.execution.hops} ${r.execution.hops === 1 ? 'hop' : 'hops'}`
    : blocked ? 'No executable quote' : 'Listed price';
  const StateIcon = blocked ? StopIcon : r.verdict === 'caution' ? AlertIcon : CheckIcon;
  return (
    <li className={`version is-${r.verdict}${isBest ? ' is-best' : ''}${isBuying ? ' is-buying' : ''}`}>
      <div className="version-head">
        <IssuerMark provider={r.provider} size={28} />
        <div>
          <div className="version-symbol mono">{r.symbol}</div>
          <div className="muted small">{PROVIDERS[r.provider]?.name} · {how}</div>
        </div>
        <span className={`state state-${isBest ? 'best' : r.verdict}`}>
          <StateIcon width={14} height={14} />
          {isBest ? 'Best' : { ok: 'Clean', caution: 'Caution', blocked: 'Refused' }[r.verdict]}
        </span>
      </div>
      <dl className="version-figures">
        <div><dt>Per real share</dt><dd className="mono">{blocked && !r.execution ? <s>{usd(r.perShare)}</s> : usd(r.perShare)}</dd></div>
        <div><dt>vs stock</dt><dd className={`mono ${Math.abs(r.premiumPct ?? 0) > AXIS ? 'bad' : Math.abs(r.premiumPct ?? 0) > 1 ? 'warn' : ''}`}>{pct(r.premiumPct)}</dd></div>
        <div><dt>{usd(usdAmount, 0)} buys</dt><dd className="mono">{blocked ? '—' : shares(r.sharesForUsd)}</dd></div>
      </dl>
      {main.length > 0 && (
        <ul className="version-reasons">
          {main.map((x) => <li key={x.code + x.message} className={x.severity === 'block' ? 'bad' : 'warn'}>{x.message}</li>)}
        </ul>
      )}
      {canBuy && !isBuying && (
        <button type="button" className={`btn ${isBest ? 'btn-accent' : 'btn-line'} version-buy`} onClick={onBuy}>
          Buy {r.symbol}
        </button>
      )}
    </li>
  );
}

function Skeleton() {
  return (
    <section className="result" aria-busy="true" aria-label="Loading comparison">
      <div className="verdict-grid">
        <div className="net-tag skeleton" />
        <div className="strip skeleton" />
      </div>
      <ol className="versions">{[0, 1, 2].map((i) => <li key={i} className="version skeleton" />)}</ol>
    </section>
  );
}
