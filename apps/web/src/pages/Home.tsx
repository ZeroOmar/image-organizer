import { Link } from 'react-router-dom';
import { useConfig, useImportCount } from '../api/hooks';
import { Logo } from '../components/Logo';

export function HomePage() {
  const pending = useImportCount().data?.count;
  const version = useConfig().data?.version;
  return (
    <div className="page-inner">
      <div className="home-hero">
        <Logo size={72} />
        <div>
          <div className="eyebrow">
            Photo &amp; video library{version && <span style={{ textTransform: 'none' }}> · v{version}</span>}
          </div>
          <h1 className="display-lg">Image Organizer</h1>
        </div>
      </div>
      <div className="home-grid">
        <Link to="/import" className="home-card">
          <span className="eyebrow">Step 1 · Ingest</span>
          <h2 className="card-title">Import</h2>
          <p className="muted body-sm" style={{ margin: 0 }}>
            Upload or collect incoming media and move it into an album.
          </p>
          <div className="card-foot">
            <span className={`pill ${pending ? 'pill-accent' : ''}`}>{pending === undefined ? '…' : `${pending} pending`}</span>
            <span aria-hidden>→</span>
          </div>
        </Link>
        <Link to="/organize" className="home-card nomad">
          <span className="eyebrow">Step 2 · Fix &amp; rename</span>
          <h2 className="card-title">Organize</h2>
          <p className="muted body-sm" style={{ margin: 0 }}>
            Browse folders, fix dates, timezones and GPS, and rename by template.
          </p>
          <div className="card-foot">
            <span />
            <span aria-hidden>→</span>
          </div>
        </Link>
        <Link to="/automation" className="home-card">
          <span className="eyebrow">Rules</span>
          <h2 className="card-title">Automation</h2>
          <p className="muted body-sm" style={{ margin: 0 }}>
            Saved pipelines that run on demand, on a schedule or when files arrive.
          </p>
          <div className="card-foot">
            <span />
            <span aria-hidden>→</span>
          </div>
        </Link>
        <div className="home-card disabled" aria-disabled="true">
          <span className="eyebrow">Integration</span>
          <h2 className="card-title">Immich API</h2>
          <p className="muted body-sm" style={{ margin: 0 }}>
            Sync with an Immich server.
          </p>
          <div className="card-foot">
            <span className="pill">TBA</span>
          </div>
        </div>
        <Link to="/settings" className="home-card">
          <span className="eyebrow">Preferences</span>
          <h2 className="card-title">Settings</h2>
          <p className="muted body-sm" style={{ margin: 0 }}>
            Rename templates, date sources, issue highlighting and trash.
          </p>
          <div className="card-foot">
            <span />
            <span aria-hidden>→</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
