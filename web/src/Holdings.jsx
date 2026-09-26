import { useEffect, useState } from 'react';
import { fetchHoldings } from './api.js';
import { shares, usd } from './format.js';
import { ArrowRight } from './icons.jsx';
import { shortName } from './StockPicker.jsx';
import { CompanyMark, IssuerMark, PROVIDERS } from './ui.jsx';
import { shortAddress } from './wallet.js';

export default function Holdings({ wallet, walletError, onConnect, onOpen, active }) {
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (!active || !wallet?.address) return;
    let live = true;
    setState({ status: 'loading' });
    fetchHoldings(wallet.address)
      .then((d) => live && setState({ status: 'ready', rows: d.holdings }))
      .catch((e) => live && setState({ status: 'error', message: e.message }));
    return () => { live = false; };
  }, [active, wallet?.address]);

  const total = state.rows?.reduce((sum, r) => sum + (r.valueUsd ?? 0), 0) ?? 0;

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <h1 className="page-title">Holdings</h1>
          <p className="page-lede">Your tokenized stocks on BNB Chain, counted in real shares rather than tokens.</p>
        </header>

        {!wallet ? (
          <div className="gate">
            <p>Connect the wallet you hold tokenized stocks in.</p>
            <button type="button" className="btn btn-accent" onClick={onConnect}>Connect wallet</button>
            {walletError && <p className="banner is-bad" role="alert">{walletError}</p>}
          </div>
        ) : state.status === 'loading' ? (
          <div className="holdings skeleton" aria-busy="true" />
        ) : state.status === 'error' ? (
          <p className="banner is-bad" role="alert">{state.message}</p>
        ) : state.status === 'ready' && state.rows.length === 0 ? (
          <div className="gate">
            <p>{shortAddress(wallet.address)} holds no tokenized stocks on BNB Chain yet.</p>
            <button type="button" className="btn btn-accent" onClick={() => onOpen('GOOGL')}>Find your first share <ArrowRight /></button>
          </div>
        ) : state.status === 'ready' ? (
          <>
            <div className="holdings-total">
              <span className="muted">Listed value</span>
              <span className="holdings-total-value mono">{usd(total)}</span>
              <span className="muted small">{shortAddress(wallet.address)} · Binance Wallet API balances</span>
            </div>
            <ol className="holdings">
              {state.rows.map((r) => (
                <li key={r.address} className="holding">
                  <CompanyMark logo={r.logo} ticker={r.ticker} size={40} />
                  <div className="holding-name">
                    <div>{shortName(r.name) || r.ticker}</div>
                    <div className="muted small"><IssuerMark provider={r.provider} size={14} /> {r.symbol} · {PROVIDERS[r.provider]?.name}</div>
                  </div>
                  <dl className="holding-figures">
                    <div><dt>Real shares</dt><dd className="mono">{shares(r.shares)}</dd></div>
                    <div><dt>Tokens held</dt><dd className="mono">{shares(r.tokens)}</dd></div>
                    <div><dt>Listed value</dt><dd className="mono">{r.valueUsd !== null ? usd(r.valueUsd) : '—'}</dd></div>
                  </dl>
                  <button type="button" className="btn btn-line" onClick={() => onOpen(r.ticker)}>Compare</button>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
    </div>
  );
}
