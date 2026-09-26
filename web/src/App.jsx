import { useEffect, useState } from 'react';
import { fetchHealth } from './api.js';
import Compare from './Compare.jsx';
import Rules from './Rules.jsx';

const TABS = [
  { id: 'compare', label: 'Compare' },
  { id: 'rules', label: 'Rules' },
];

export default function App() {
  const [tab, setTab] = useState('compare');
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  const onKeyDown = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length].id);
    if (e.key === 'ArrowLeft') setTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">Nett</span>
        <nav className="tabs" role="tablist" aria-label="Sections" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {health && health.ok && !health.quotes && (
        <p className="mode-banner" role="status">
          Listed prices only: live quotes are switched off on this server, so no row is marked executable.
        </p>
      )}
      {health && !health.ok && (
        <p className="mode-banner is-error" role="alert">
          Nett's server is not responding. Comparisons will fail until it is back.
        </p>
      )}

      <main>
        <section id="panel-compare" role="tabpanel" aria-labelledby="tab-compare" hidden={tab !== 'compare'}>
          <Compare />
        </section>
        <section id="panel-rules" role="tabpanel" aria-labelledby="tab-rules" hidden={tab !== 'rules'}>
          <Rules />
        </section>
      </main>

      <footer className="footer">
        <span>Data and quotes: Binance Web3 API · BNB Smart Chain</span>
        <span>Not investment advice. Tokenized stocks are not available to US persons.</span>
        {health?.revision && <span className="muted">build {health.revision}</span>}
      </footer>
    </div>
  );
}
