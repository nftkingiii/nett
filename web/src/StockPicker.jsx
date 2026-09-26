import { useId, useMemo, useRef, useState } from 'react';
import { CompanyMark } from './ui.jsx';

export const shortName = (name) =>
  (name ?? '').replace(/,?\s+(Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|plc|N\.?V\.?|Holding|Holdings|Co\.?)\b.*$/i, '').trim();

// Accessible combobox: type a company or ticker, pick from logos, Enter to choose.
export default function StockPicker({ stocks, value, onChange }) {
  const [query, setQuery] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef(null);
  const selected = stocks.find((s) => s.ticker === value);
  const display = query ?? (selected ? `${shortName(selected.name) || selected.ticker}` : value);

  const matches = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const list = q
      ? stocks.filter((s) => s.ticker.toLowerCase().startsWith(q) || (s.name ?? '').toLowerCase().includes(q))
      : stocks.filter((s) => s.versions.length > 1);
    return list.slice(0, 8);
  }, [stocks, query]);

  const choose = (s) => {
    onChange(s.ticker);
    setQuery(null);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(null); }
  };

  return (
    <div className="picker">
      <CompanyMark logo={selected?.logo} ticker={value} size={30} />
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Stock"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        value={display}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={(e) => { e.target.select(); setOpen(true); }}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(null); }, 120)}
        onKeyDown={onKeyDown}
      />
      <span className="picker-ticker mono">{selected?.ticker ?? ''}</span>
      {open && matches.length > 0 && (
        <ul className="picker-list" role="listbox" id={listId}>
          {matches.map((s, i) => (
            <li
              key={s.ticker}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              onMouseEnter={() => setActive(i)}
            >
              <CompanyMark logo={s.logo} ticker={s.ticker} size={28} />
              <span className="picker-name">{shortName(s.name) || s.ticker}</span>
              <span className="mono muted">{s.ticker}</span>
              <span className="picker-count">{s.versions.length}×</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
