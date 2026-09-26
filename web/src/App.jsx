import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, fetchStocks } from './api.js';
import { connect, discoverWallets, shortAddress, BSC_CHAIN_HEX } from './wallet.js';
import { BookIcon, CompassIcon, TagIcon, WalletIcon } from './icons.jsx';
import Buy from './Buy.jsx';
import Discover from './Discover.jsx';
import Holdings from './Holdings.jsx';
import Rules from './Rules.jsx';

const TABS = [
  { id: 'buy', label: 'Buy', Icon: TagIcon },
  { id: 'discover', label: 'Discover', Icon: CompassIcon },
  { id: 'holdings', label: 'Holdings', Icon: WalletIcon },
  { id: 'rules', label: 'Rules', Icon: BookIcon },
];

export default function App() {
  const [tab, setTab] = useState('buy');
  const [health, setHealth] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [stocksError, setStocksError] = useState(null);
  const [request, setRequest] = useState({ ticker: 'GOOGL', nonce: 0 });
  const [wallets, setWallets] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [picking, setPicking] = useState(false);
  const [walletError, setWalletError] = useState(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth({ ok: false }));
    fetchStocks().then(setStocks).catch(() => setStocksError('Could not load the stock list.'));
  }, []);
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
    setPicking((v) => !v);
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

  const openStock = (ticker) => {
    setRequest((r) => ({ ticker, nonce: r.nonce + 1 }));
    setTab('buy');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length].id);
    if (e.key === 'ArrowLeft') setTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
  };

  const wrongNetwork = wallet && wallet.chainId?.toLowerCase() !== BSC_CHAIN_HEX;

  return (
    <div className={`app tab-${tab}`}>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <button type="button" className="wordmark" onClick={() => setTab('buy')} aria-label="Nett home">
            nett<span className="wordmark-dot" aria-hidden="true" />
          </button>
          <nav className="tabs" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                className="tab"
                onClick={() => setTab(id)}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="wallet-slot">
            {wallet ? (
              <span className={`wallet-chip${wrongNetwork ? ' is-wrong' : ''}`} title={wallet.address}>
                {wallet.icon && <img src={wallet.icon} alt="" width="18" height="18" />}
                {shortAddress(wallet.address)}
                {wrongNetwork && <span className="small"> · wrong network</span>}
              </span>
            ) : (
              <button type="button" className="btn btn-dark" onClick={requestConnect}>Connect wallet</button>
            )}
            {picking && (
              <ul className="wallet-menu" role="menu">
                {wallets.map((w) => (
                  <li key={w.id}>
                    <button type="button" role="menuitem" onClick={() => connectWith(w)}>
                      {w.icon && <img src={w.icon} alt="" width="22" height="22" />} {w.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </header>

      {(health && !health.ok) || (health?.ok && !health.quotes) ? (
        <div className="wrap">
          <p className={`banner ${health.ok ? '' : 'is-bad'}`} role="status">
            {health.ok
              ? 'Listed prices only: live quotes are switched off on this server, so nothing is marked executable.'
              : "Nett's server is not responding. Comparisons will fail until it is back."}
          </p>
        </div>
      ) : null}

      <main>
        <section id="panel-buy" role="tabpanel" aria-labelledby="tab-buy" hidden={tab !== 'buy'}>
          <Buy stocks={stocks} request={request} wallet={wallet} walletError={walletError} onConnect={requestConnect} />
        </section>
        <section id="panel-discover" role="tabpanel" aria-labelledby="tab-discover" hidden={tab !== 'discover'}>
          <Discover stocks={stocks} error={stocksError} onOpen={openStock} />
        </section>
        <section id="panel-holdings" role="tabpanel" aria-labelledby="tab-holdings" hidden={tab !== 'holdings'}>
          <Holdings wallet={wallet} walletError={walletError} onConnect={requestConnect} onOpen={openStock} active={tab === 'holdings'} />
        </section>
        <section id="panel-rules" role="tabpanel" aria-labelledby="tab-rules" hidden={tab !== 'rules'}>
          <Rules />
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span className="wordmark small-mark">nett</span>
          <span>Quotes, simulation and balances from the Binance Web3 API on BNB Smart Chain.</span>
          <span>Not investment advice. Tokenized stocks are not offered to US persons.</span>
          {health?.revision && <span className="mono muted">build {health.revision}</span>}
        </div>
      </footer>
    </div>
  );
}
