import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Sheet } from './Sheet';
import { NAV_LINKS, useLogout } from './TopNav';

const TABS = ['/organize', '/import', '/gps'];

const icon = (d: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

const ICONS: Record<string, ReactNode> = {
  '/organize': icon(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>,
  ),
  '/import': icon(
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </>,
  ),
  '/gps': icon(
    <>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>,
  ),
  more: icon(
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>,
  ),
};

/** Phone navigation: Organize · Import · GPS, and a More sheet with every other page. Hidden while selecting files. */
export function TabBar() {
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const logout = useLogout();
  const tabs = NAV_LINKS.filter((l) => TABS.includes(l.to)).sort((a, b) => TABS.indexOf(a.to) - TABS.indexOf(b.to));
  const others = [{ to: '/', label: 'Home' }, ...NAV_LINKS.filter((l) => !TABS.includes(l.to))];
  const moreActive = !TABS.some((t) => pathname.startsWith(t));

  return (
    <nav className="tabbar" aria-label="Pages">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}>
          {ICONS[t.to]}
          <span>{t.label}</span>
        </NavLink>
      ))}
      <button className={`tab-item${moreActive || more ? ' active' : ''}`} onClick={() => setMore(true)}>
        {ICONS.more}
        <span>More</span>
      </button>
      {more && (
        <Sheet title="Pages" onClose={() => setMore(false)}>
          <div className="more-list">
            {others.map((l) => (
              <NavLink key={l.to} to={l.to} end className={({ isActive }) => `more-link${isActive ? ' active' : ''}`} onClick={() => setMore(false)}>
                {l.label}
              </NavLink>
            ))}
            <button className="more-link" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </Sheet>
      )}
    </nav>
  );
}
