import { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from './api.js';
import { connect, discoverWallets, shortAddress, BSC_CHAIN_HEX } from './wallet.js';
import Compare from './Compare.jsx';
import Rules from './Rules.jsx';

const TABS = [
  { id: 'compare', label: 'Compare' },
  { id: 'rules', label: 'Rules' },
];

export default function App() {
  const [tab, setTab] = useState('compare');
  const [health, setHealth] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [picking, setPicking] = useState(false);
  const [walletError, setWalletError] = useState(null);

  useEffect(() => discoverWallets(setWallets), []);

  const connectWith = useCallback(async (w) => {
    setPicking(false);
    setWalletError(null);
    try {
      const { address, chainId } = await connect(w.provider);
      setWallet({ ...w, address, chainId });
    } catch (err) {
      setWalletError(err?.code === 4001 ? 'Connection declined in your wallet.' : err.message);
    }
  }, []);

  const requestConnect = useCallback(() => {
    if (wallets.length === 0) return setWalletError('No browser wallet found. Install the Binance Wallet extension, then reload.');
    if (wallets.length === 1) return connectWith(wallets[0]);
    setPicking(true);
  }, [wallets, connectWith]);

  // Follow account and network changes made inside the wallet.
  useEffect(() => {
    const p = wallet?.provider;
    if (!p?.on) return;
    const onAccounts = (accounts) => (accounts[0] ? setWallet((w) => ({ ...w, address: accounts[0] })) : setWallet(null));
    const onChain = (chainId) => setWallet((w) => ({ ...w, chainId }));
    p.on('accountsChanged', onAccounts);
    p.on('chainChanged', onChain);
    return () => {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('chainChanged', onChain);
    };
  }, [wallet?.provider]);

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
        <div className="wallet-slot">
          {wallet ? (
            <span className={`wallet-chip${wallet.chainId?.toLowerCase() !== BSC_CHAIN_HEX ? ' is-wrong' : ''}`} title={wallet.address}>
              {wallet.icon && <img src={wallet.icon} alt="" width="18" height="18" />}
              {shortAddress(wallet.address)}
              {wallet.chainId?.toLowerCase() !== BSC_CHAIN_HEX && ' · wrong network'}
            </span>
          ) : (
            <button type="button" className="ghost" onClick={requestConnect}>Connect wallet</button>
          )}
          {picking && (
            <ul className="wallet-menu" role="menu">
              {wallets.map((w) => (
                <li key={w.id}>
                  <button type="button" role="menuitem" onClick={() => connectWith(w)}>
                    {w.icon && <img src={w.icon} alt="" width="20" height="20" />} {w.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>
      {walletError && (
        <p className="mode-banner is-error" role="alert">{walletError}</p>
      )}

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
          <Compare wallet={wallet} walletError={walletError} onConnect={requestConnect} />
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
