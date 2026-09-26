import { useMemo, useState } from 'react';
import { usd } from './format.js';
import { ArrowRight, SearchIcon } from './icons.jsx';
import { shortName } from './StockPicker.jsx';
import { CompanyMark, IssuerMark, PROVIDERS } from './ui.jsx';

const FILTERS = [
  { id: 'multi', label: 'On 2+ issuers' },
  { id: 'three', label: 'On all 3' },
  { id: 'all', label: 'Everything' },
];
const SORTS = [
  { id: 'gap', label: 'Listed gap' },
  { id: 'versions', label: 'Versions' },
  { id: 'name', label: 'A–Z' },
];

export default function Discover({ stocks, error, onOpen }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('multi');
  const [sort, setSort] = useState('gap');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = stocks.filter((s) =>
      filter === 'three' ? s.versions.length >= 3 : filter === 'multi' ? s.versions.length > 1 : true,
    );
    if (needle) list = list.filter((s) => s.ticker.toLowerCase().includes(needle) || (s.name ?? '').toLowerCase().includes(needle));
    const by = {
      gap: (a, b) => (b.listedGapPct ?? -1) - (a.listedGapPct ?? -1),
      versions: (a, b) => b.versions.length - a.versions.length || a.ticker.localeCompare(b.ticker),
      name: (a, b) => (shortName(a.name) || a.ticker).localeCompare(shortName(b.name) || b.ticker),
    }[sort];
    return [...list].sort(by);
  }, [stocks, q, filter, sort]);

  const three = stocks.filter((s) => s.versions.length >= 3).length;
  const multi = stocks.filter((s) => s.versions.length > 1).length;

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <h1 className="page-title">Discover</h1>
          <p className="page-lede">
            {stocks.length ? (
              <>
                <strong>{stocks.length}</strong> US stocks and ETFs trade on BNB Chain. <strong>{multi}</strong> of them
                come in more than one wrapper, and <strong>{three}</strong> in all three.
              </>
            ) : error ?? 'Loading the list of tokenized stocks…'}
          </p>
        </header>

        <div className="explorer">
          <div className="explorer-controls">
            <label className="search">
              <SearchIcon />
              <span className="visually-hidden">Search stocks</span>
              <input placeholder="Search a company or ticker" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="chip-row" role="group" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className={`chip${filter === f.id ? ' is-on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
              <span className="chip-label">Sort</span>
              {SORTS.map((s) => (
                <button key={s.id} type="button" className={`chip${sort === s.id ? ' is-on' : ''}`} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Wrappers</th>
                  <th scope="col" className="num">Ondo / share</th>
                  <th scope="col" className="num">bStock / share</th>
                  <th scope="col" className="num">Listed gap</th>
                  <th scope="col"><span className="visually-hidden">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 150).map((s, i) => {
                  const ondo = s.versions.find((v) => v.provider === 'ondo');
                  const bstock = s.versions.find((v) => v.provider === 'bstock');
                  return (
                    <tr key={s.ticker} onClick={() => onOpen(s.ticker)}>
                      <td className="num muted">{i + 1}</td>
                      <td>
                        <div className="cell-stock">
                          <CompanyMark logo={s.logo} ticker={s.ticker} size={34} />
                          <div>
                            <div className="cell-name">{shortName(s.name) || s.ticker}</div>
                            <div className="mono muted small">{s.ticker}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="wrappers">
                          {['ondo', 'xstocks', 'bstock'].map((p) => {
                            const v = s.versions.find((x) => x.provider === p);
                            return (
                              <span key={p} className={`wrapper${v ? '' : ' is-absent'}${v?.status ? ` is-${v.status}` : ''}`} title={v ? `${v.symbol}${v.status === 'closed' ? ' · closed until the US market reopens' : v.status === 'halted' ? ` · halted${v.reason ? `: ${v.reason}` : ''}` : ''}` : `No ${PROVIDERS[p].name} version`}>
                                <IssuerMark provider={p} size={16} />
                                <span className="mono">{v ? PROVIDERS[p].suffix : '—'}</span>
                                {v?.status === 'closed' && <span className="visually-hidden">closed</span>}
                                {v?.status === 'halted' && <span className="visually-hidden">halted</span>}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="num mono">{ondo?.listedPerShare ? usd(ondo.listedPerShare) : '—'}</td>
                      <td className="num mono">{bstock?.listedPerShare ? usd(bstock.listedPerShare) : '—'}</td>
                      <td className={`num mono ${s.listedGapPct > 1 ? 'warn' : ''}`}>{s.listedGapPct !== null ? `${s.listedGapPct.toFixed(2)}%` : '—'}</td>
                      <td className="num">
                        <button type="button" className="row-open" onClick={(e) => { e.stopPropagation(); onOpen(s.ticker); }} aria-label={`Compare ${s.ticker}`}>
                          Compare <ArrowRight width={14} height={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && stocks.length > 0 && <p className="empty">No stock matches “{q}”.</p>}
          </div>
          <p className="explorer-legend">
            <span className="wrapper"><span className="legend-dot is-open" />open</span>
            <span className="wrapper is-closed"><span className="legend-dot is-closed" />closed until US open</span>
            <span className="wrapper is-halted"><span className="legend-dot is-halted" />halted</span>
            <span className="wrapper is-absent"><span className="legend-dot" />no version</span>
          </p>
          <p className="explorer-note">
            Listed prices per real share from Binance's RWA data. xStocks are not in that feed, so their price appears only
            once you compare. Listed prices are not executable; Compare fetches real quotes.
          </p>
        </div>
      </div>
    </div>
  );
}
