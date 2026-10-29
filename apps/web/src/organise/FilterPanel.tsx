import type { EnrichedEntry } from '@io/shared';
import { useMemo, useState } from 'react';
import { FACETS, facetValues, type FilterState } from './filters';

export function FilterPanel({
  entries,
  state,
  onChange,
}: {
  entries: EnrichedEntry[];
  state: FilterState;
  onChange: (s: FilterState) => void;
}) {
  const values = useMemo(() => facetValues(entries), [entries]);
  const [open, setOpen] = useState<Set<string>>(new Set(['issues', 'type']));
  const toggleOpen = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleValue = (facet: string, key: string) => {
    const cur = state[facet] ?? [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    onChange({ ...state, [facet]: next });
  };
  const activeCount = Object.values(state).reduce((n, v) => n + v.length, 0);

  return (
    <div>
      {activeCount > 0 && (
        <div style={{ padding: '6px 12px' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => onChange({})}>
            Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </button>
        </div>
      )}
      {FACETS.map((f) => {
        const vals = values[f.id] ?? [];
        if (!vals.length) return null;
        const isOpen = open.has(f.id);
        const sel = state[f.id] ?? [];
        return (
          <div className="facet" key={f.id}>
            <button className="facet-head" onClick={() => toggleOpen(f.id)} aria-expanded={isOpen}>
              <span className="tree-twisty">{isOpen ? '▼' : '▶'}</span>
              <span className="grow">{f.label}</span>
              {sel.length > 0 && <span className="pill pill-accent">{sel.length}</span>}
            </button>
            {isOpen && (
              <div className="facet-values">
                {vals.map((v) => (
                  <label className="check" key={v.key}>
                    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <input type="checkbox" checked={sel.includes(v.key)} onChange={() => toggleValue(f.id, v.key)} />
                      <span>{v.label}</span>
                    </span>
                    <span className="count">{v.count}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
