import type { RootName } from '@io/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { FolderTree } from './FolderTree';

/** Pick a destination folder, with "New folder" inside the selected one. */
export function FolderPicker({
  root,
  value,
  onChange,
  rootLabel,
}: {
  root: RootName;
  value: string;
  onChange: (rel: string) => void;
  rootLabel: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setError(null);
    try {
      const made = await api<{ rel: string }>('/api/folders', { method: 'POST', body: { root, rel: value, name: name.trim() } });
      await qc.invalidateQueries({ queryKey: ['tree', root] });
      setName('');
      onChange(made.rel);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="folder-picker">
        <FolderTree root={root} selected={value} onSelect={onChange} rootLabel={rootLabel} />
      </div>
      <div className="caption muted">
        Destination: <span className="mono">{rootLabel}/{value}</span>
      </div>
      <div className="row">
        <input
          className="input grow"
          placeholder="New folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()}
        />
        <button className="btn" onClick={create} disabled={!name.trim()}>
          New folder
        </button>
      </div>
      {error && <div className="error-text caption">{error}</div>}
    </div>
  );
}
