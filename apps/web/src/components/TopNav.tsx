import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import { JobsMenu } from './JobsMenu';
import { Logo } from './Logo';

export const NAV_LINKS = [
  { to: '/import', label: 'Import' },
  { to: '/organize', label: 'Organize' },
  { to: '/gps', label: 'GPS' },
  { to: '/convert', label: 'Convert' },
  { to: '/duplicates', label: 'Duplicates' },
  { to: '/automation', label: 'Automation' },
  { to: '/trash', label: 'Trash' },
  { to: '/settings', label: 'Settings' },
];

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    qc.setQueryData(keys.me, null);
    navigate('/login');
  };
}

/** Desktop: brand, page links, Jobs, Sign out. Phone (`compact`): brand, page title, Jobs; the links live in the TabBar. */
export function TopNav({ compact }: { compact?: boolean }) {
  const logout = useLogout();
  const { pathname } = useLocation();
  if (compact) {
    const title = NAV_LINKS.find((l) => pathname.startsWith(l.to))?.label ?? 'Image Organizer';
    return (
      <header className="topnav compact">
        <Link to="/" className="brand" aria-label="Home">
          <Logo size={26} />
        </Link>
        <span className="topnav-title grow">{title}</span>
        <JobsMenu />
      </header>
    );
  }
  return (
    <header className="topnav">
      <Link to="/" className="brand">
        <Logo size={28} />
        <span className="brand-word">Image Organizer</span>
      </Link>
      <nav className="nav-links">
        {NAV_LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <JobsMenu />
      <button className="btn btn-ghost btn-sm" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}
