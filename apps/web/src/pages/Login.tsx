import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import { Logo } from '../components/Logo';

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api<{ username: string }>('/api/auth/login', { method: 'POST', body: { username, password } });
      qc.setQueryData(keys.me, me);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <Logo size={64} />
        <div>
          <div className="eyebrow">Image Organizer</div>
          <h1 className="headline">Sign in</h1>
        </div>
        <div className="field">
          <label htmlFor="u">Username</label>
          <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input
            id="p"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="error-text caption">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
