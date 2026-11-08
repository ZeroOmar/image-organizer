import { useEffect, useState } from 'react';

/** Phone layout breakpoint (matches the `max-width: 768px` media queries in app.css). */
export const COMPACT_QUERY = '(max-width: 768px)';

const mql = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(COMPACT_QUERY) : null);

/** True on phone-width screens: the shell shows the bottom tab bar and the Workspace renders one column. */
export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => mql()?.matches ?? false);
  useEffect(() => {
    const m = mql();
    if (!m) return;
    const on = () => setCompact(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return compact;
}
