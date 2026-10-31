import { useCallback, useRef } from 'react';

export type Selection = Set<string>;

export interface PickModifiers {
  shift?: boolean;
  /** Cmd (macOS) or Ctrl. */
  meta?: boolean;
  /** A touch tap: toggles like Cmd/Ctrl-click so a tablet can multi-select. */
  touch?: boolean;
}

/**
 * Finder/Bridge-style click selection over an ordered list of rels: click selects one, Cmd/Ctrl-click toggles,
 * Shift-click selects the range from the last clicked item (adding to the selection with Cmd/Ctrl), touch toggles.
 */
export function useSelectClick({
  order,
  selection,
  onSelection,
  onFocus,
}: {
  order: string[];
  selection: Selection;
  onSelection: (s: Selection) => void;
  onFocus: (rel: string | null) => void;
}) {
  const anchor = useRef<string | null>(null);

  const selectRange = useCallback(
    (rel: string, base: Selection) => {
      const [a, b] = [order.indexOf(anchor.current!), order.indexOf(rel)].sort((x, y) => x - y);
      const next = new Set(base);
      if (a >= 0) for (const r of order.slice(a, b + 1)) next.add(r);
      onSelection(next);
    },
    [order, onSelection],
  );

  const pick = useCallback(
    (rel: string, m: PickModifiers = {}) => {
      if (m.shift && anchor.current && order.includes(anchor.current)) {
        selectRange(rel, m.meta ? selection : new Set());
      } else if (m.touch || m.meta) {
        const next = new Set(selection);
        if (next.has(rel)) next.delete(rel);
        else next.add(rel);
        onSelection(next);
        anchor.current = rel;
      } else {
        onSelection(new Set([rel]));
        anchor.current = rel;
      }
      onFocus(rel);
    },
    [order, selection, onSelection, onFocus, selectRange],
  );

  return { pick, selectRange, anchor };
}
