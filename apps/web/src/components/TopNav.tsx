import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import { JobsMenu } from './JobsMenu';
import { Logo } from './Logo';

const LINKS = [
  { to: '/import', label: 'Import' },
  { to: '/organize', label: 'Organize' },
  { to: '/automation', label: 'Automation' },
  { to: '/trash', label: 'Trash' },
  { to: '/settings', label: 'Settings' },
];

export function TopNav() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    qc.setQueryData(keys.me, null);
    navigate('/login');
  };
  return (
    <header className="topnav">
      <Link to="/" className="brand">
        <Logo size={28} />
        <span className="brand-word">Image Organizer</span>
      </Link>
      <nav className="nav-links">
        {LINKS.map((l) => (
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
