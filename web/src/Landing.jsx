import { useEffect, useState } from 'react';
import { fetchShowcase } from './api.js';
import { pct, shares, time, usd } from './format.js';
import { AlertIcon, ArrowRight, CheckIcon, StopIcon } from './icons.jsx';
import { shortName } from './StockPicker.jsx';
import { CompanyMark, IssuerMark, PROVIDERS } from './ui.jsx';

const STEPS = [
  { title: 'Count real shares', body: 'Every token stands for its own number of shares. Nett divides each price by that multiplier first.', detail: 'price ÷ multiplier' },
  { title: 'Quote your exact amount', body: 'Listed prices are not tradeable. Nett asks Binance’s Trading API what your money buys, right now.', detail: 'Trading API · quote' },
  { title: 'Refuse the unsafe', body: 'No liquidity, closed issuer, halted stock, or drifted too far from the real price — refused, with the reason.', detail: 'e.g. 40374 · no liquidity' },
  { title: 'Simulate, then you sign', body: 'Nett approves only what you spend and simulates the swap. Your wallet signs; Nett never holds keys.', detail: 'Transaction API · simulate' },
];

const FAQ = [
  { q: 'Does Nett hold my money?', a: 'No. Nett builds unsigned transactions and your own wallet signs and sends them. Approvals are for the exact amount you spend, never unlimited.' },
  { q: 'Who actually executes the trade?', a: 'Binance Web3’s Trading API routes the swap across BNB Chain venues such as PancakeSwap. Nett chooses which version of the stock to buy and checks the route before you sign.' },
  { q: 'What does it cost?', a: 'Nett adds no fee. You pay the route’s trading fee and BNB Chain gas, both shown by the quote and simulation before you confirm.' },
  { q: 'Which stocks can I buy?', a: 'Any US stock or ETF with a tokenized version on BNB Chain from Ondo, xStocks or bStock — the list is live on the Discover tab.' },
  { q: 'Who can use it?', a: 'Tokenized stocks are not offered to US persons, and the Binance Web3 API is unavailable in some regions. Nett is a tool, not investment advice.' },
];

export default function Landing() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchShowcase().then(setData).catch(() => setError('Live data is unavailable right now.'));
  }, []);

  const ex = data?.example;
  const best = ex?.routes?.find((r) => r.symbol === ex.best);

  return (
    <div className="landing">
      <header className="l-nav">
        <div className="wrap l-nav-inner">
          <a className="wordmark" href="/" aria-label="Nett home">nett<span className="wordmark-dot" aria-hidden="true" /></a>
          <nav className="l-links" aria-label="Page">
            <a href="#proof">Proof</a>
            <a href="#how">How it works</a>
            <a href="#faq">Questions</a>
          </nav>
          <a className="btn l-open" href="/app">Open app <ArrowRight /></a>
        </div>
      </header>

      <section className="l-hero">
        <div className="wrap l-hero-inner">
          <div className="l-hero-copy">
            <h1 className="l-title"><span className="nowrap">Buy the share,</span> <span className="nowrap">not the wrapper.</span></h1>
            <p className="l-lede">
              Apple, Nvidia and hundreds more trade on BNB Chain as up to three different tokens — with different prices,
              hours and liquidity. Nett tells you which one actually buys the most stock, refuses the ones that can’t, and
              lets you buy it from your own wallet.
            </p>
            <div className="l-ctas">
              <a className="btn btn-white" href="/app">Weigh a stock <ArrowRight /></a>
              <a className="btn btn-ghost-light" href="#how">How it decides</a>
            </div>
            <p className="l-hint">Compare first. No wallet needed.</p>
          </div>

          <figure className="l-live" aria-live="polite">
            {ex ? (
              <>
                <div className="l-live-head">
                  <CompanyMark logo={ex.stock?.logo} ticker={ex.ticker} size={40} />
                  <div>
                    <div className="l-live-title">{shortName(ex.stock?.name) || ex.ticker} · {usd(ex.usd, 0)}</div>
                    <div className="muted small mono">live · weighed {time(ex.at)}</div>
                  </div>
                </div>
                {best && (
                  <div className="l-live-weight">
                    <span className="mono l-live-number">{shares(best.sharesForUsd)}</span>
                    <span>real shares via <strong className="mono">{best.symbol}</strong></span>
                  </div>
                )}
                <ul className="l-live-rows">
                  {ex.routes.map((r) => (
                    <li key={r.symbol} className={`is-${r.verdict}${r.symbol === ex.best ? ' is-best' : ''}`}>
                      <IssuerMark provider={r.provider} size={22} />
                      <span className="mono l-live-sym">{r.symbol}</span>
                      <span className="mono">{r.verdict === 'blocked' && !r.execution ? '—' : usd(r.perShare)}</span>
                      <Verdict route={r} isBest={r.symbol === ex.best} />
                    </li>
                  ))}
                </ul>
                <figcaption className="small">Per real share, from live quotes. Nothing is bought here.</figcaption>
              </>
            ) : (
              <div className="l-live-empty">{error ?? 'Weighing Alphabet live…'}</div>
            )}
          </figure>
        </div>
      </section>

      <section className="l-why">
        <div className="wrap">
          <h2 className="l-h2">One stock. Three tokens.<br />Three different prices.</h2>
          <dl className="l-stats">
            <div><dt>US stocks and ETFs on BNB Chain</dt><dd className="mono">{data?.counts.stocks ?? '—'}</dd></div>
            <div><dt>come in more than one wrapper</dt><dd className="mono">{data?.counts.multi ?? '—'}</dd></div>
            <div><dt>come in all three</dt><dd className="mono">{data?.counts.all3 ?? '—'}</dd></div>
            <div><dt>tokens to choose between</dt><dd className="mono">{data?.counts.versions ?? '—'}</dd></div>
          </dl>
          <p className="l-why-note">
            Ondo, xStocks and bStock each wrap the same shares differently. Their tokens don’t always equal one share, they
            keep different hours, and their liquidity comes and goes. Buying the wrong one quietly costs you stock.
          </p>
        </div>
      </section>

      <section className="l-proof" id="proof">
        <div className="wrap">
          <div className="l-proof-panel">
            <div className="l-proof-main">
              <h2 className="l-h2 on-dark">A listed price<br />is not a price.</h2>
              <p className="l-proof-lede">
                What each version of {shortName(ex?.stock?.name) || 'Alphabet'} shows on the chain, against what {usd(ex?.usd ?? 10, 0)} actually buys.
              </p>
              {ex ? (
                <table className="l-proof-table">
                  <thead>
                    <tr><th scope="col">Version</th><th scope="col" className="num">Listed / share</th><th scope="col" className="num">Real quote / share</th><th scope="col">Nett</th></tr>
                  </thead>
                  <tbody>
                    {ex.routes.map((r) => (
                      <tr key={r.symbol}>
                        <td><span className="l-proof-sym"><IssuerMark provider={r.provider} size={18} /> <span className="mono">{r.symbol}</span></span></td>
                        <td className="num mono">{usd(r.listedPerShare)}</td>
                        <td className="num mono">{r.priceBasis === 'quote' ? usd(r.perShare) : <span className="bad">no quote</span>}</td>
                        <td>
                          <Verdict route={r} isBest={r.symbol === ex.best} />
                          {r.verdict === 'blocked' && <div className="l-proof-reason">{r.reasons.find((x) => x.severity === 'block')?.message}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="l-proof-lede">{error ?? 'Loading live quotes…'}</p>
              )}
            </div>
            <aside className="l-gaps">
              <h3>Widest gaps between issuers, right now</h3>
              <ol>
                {(data?.widestGaps ?? []).map((g) => (
                  <li key={g.ticker}>
                    <CompanyMark logo={g.logo} ticker={g.ticker} size={28} />
                    <span className="l-gap-name">{shortName(g.name) || g.ticker}</span>
                    <span className="mono l-gap-value">{g.listedGapPct.toFixed(2)}%</span>
                  </li>
                ))}
              </ol>
              <p className="small">Listed price per real share, cheapest vs dearest issuer. Live from Binance RWA data.</p>
            </aside>
          </div>
        </div>
      </section>

      <section className="l-how" id="how">
        <div className="wrap">
          <h2 className="l-h2">How Nett decides</h2>
          <ol className="l-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="l-step-n mono" aria-hidden="true">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <code className="l-step-detail">{s.detail}</code>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="l-faq" id="faq">
        <div className="wrap l-faq-inner">
          <h2 className="l-h2">Before you buy</h2>
          <div className="l-faq-list">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="l-cta">
        <div className="wrap">
          <div className="l-cta-band">
            <h2 className="l-h2 on-dark">Weigh your first share.</h2>
            <p>Pick a stock and an amount. Nett shows every version side by side in seconds.</p>
            <a className="btn btn-white" href="/app">Open Nett <ArrowRight /></a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span className="wordmark small-mark">nett</span>
          <span>Quotes, simulation and balances from the Binance Web3 API on BNB Smart Chain.</span>
          <span>Not investment advice. Tokenized stocks are not offered to US persons.</span>
        </div>
      </footer>
    </div>
  );
}

function Verdict({ route, isBest }) {
  if (isBest) return <span className="state state-best"><CheckIcon width={13} height={13} />Best</span>;
  if (route.busy) return <span className="state state-caution"><AlertIcon width={13} height={13} />Busy</span>;
  if (route.verdict === 'blocked') return <span className="state state-blocked"><StopIcon width={13} height={13} />Refused</span>;
  if (route.verdict === 'caution') return <span className="state state-caution"><AlertIcon width={13} height={13} />Caution</span>;
  return <span className="state state-ok"><CheckIcon width={13} height={13} />Clean</span>;
}
