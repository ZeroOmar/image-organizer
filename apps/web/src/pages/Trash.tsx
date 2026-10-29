import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { invalidateFiles, useConfig, useTrash } from '../api/hooks';
import { Dialog } from '../components/Dialog';

const fmtSize = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);

export function TrashPage() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useTrash();
  const config = useConfig().data;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<null | 'selected' | 'all'>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (url: string, body: unknown) => {
    setError(null);
    try {
      await api(url, { method: 'POST', body });
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
    invalidateFiles(qc);
  };
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="page-inner">
      <div className="eyebrow">Separate /trash mount</div>
      <div className="row" style={{ marginBottom: 24 }}>
        <h1 className="display-md grow">Trash</h1>
        <button className="btn" disabled={!selected.size} onClick={() => run('/api/trash/restore', { ids: [...selected] })}>
          Restore ({selected.size})
        </button>
        <button className="btn btn-danger" disabled={!selected.size} onClick={() => setConfirm('selected')}>
          Delete permanently
        </button>
        <button className="btn btn-danger" disabled={!items.length} onClick={() => setConfirm('all')}>
          Empty trash
        </button>
      </div>
      {config && config.trashRetentionDays > 0 && (
        <p className="muted caption">Items older than {config.trashRetentionDays} days are deleted automatically.</p>
      )}
      {error && <p className="error-text">{error}</p>}
      {isLoading ? null : items.length === 0 ? (
        <div className="card empty">The trash is empty.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selected.size === items.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                  />
                </th>
                <th>Original location</th>
                <th>From</th>
                <th>Size</th>
                <th>Deleted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} onClick={() => toggle(i.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="mono">{i.originalRel}</td>
                  <td>
                    <span className="pill">{i.originRoot}</span>
                  </td>
                  <td>{fmtSize(i.size)}</td>
                  <td className="muted">{new Date(i.deletedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && (
        <Dialog
          title={confirm === 'all' ? 'Empty the trash?' : `Delete ${selected.size} item(s) permanently?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  run('/api/trash/purge', confirm === 'all' ? { all: true } : { ids: [...selected] });
                  setConfirm(null);
                }}
              >
                Delete permanently
              </button>
            </>
          }
        >
          <p className="muted">This can’t be undone. The files are removed from the /trash mount.</p>
        </Dialog>
      )}
    </div>
  );
}
