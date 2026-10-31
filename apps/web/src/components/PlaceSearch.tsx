import { useState, type ReactNode } from 'react';
import { useConfig } from '../api/hooks';

export interface PlaceHit {
  lat: number;
  lon: number;
  name: string;
}

/** Nominatim place search (config.nominatimUrl): input + Search button, then a result list. */
export function PlaceSearch({ onPick, disabled, extra, compact }: { onPick: (p: PlaceHit) => void; disabled?: boolean; extra?: ReactNode; compact?: boolean }) {
  const config = useConfig().data;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    if (!config || !q.trim()) return;
    setErr(null);
    try {
      const res = await fetch(`${config.nominatimUrl.replace(/\/$/, '')}/search?format=json&limit=8&q=${encodeURIComponent(q)}`, {
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      const hits = await res.json();
      setResults(hits);
      if (!hits.length) setErr('No places found');
    } catch {
      setErr('Search failed (is the browser online?)');
    }
  };

  const size = compact ? ' btn-sm' : '';
  return (
    <div className="stack place-search" style={{ gap: 6 }}>
      <div className="row" style={{ flexWrap: compact ? 'nowrap' : undefined }}>
        <input
          className={`input grow${compact ? ' input-sm' : ''}`}
          placeholder="Search a place…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          disabled={disabled}
        />
        <button className={`btn${size}`} onClick={search} disabled={disabled || !q.trim()}>
          Search
        </button>
        {extra}
      </div>
      {err && <div className="error-text caption">{err}</div>}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lon}`}
              onClick={() => {
                onPick({ lat: Number(r.lat), lon: Number(r.lon), name: r.display_name });
                setResults([]);
              }}
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
