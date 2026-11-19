import { formatDisplay, type EnrichedEntry } from '@io/shared';
import { useEffect, useRef } from 'react';
import { thumbUrl } from '../api/client';
import { SelectCheck } from '../organize/SelectCheck';
import type { WorkspaceApi } from '../organize/Workspace';

/** dataTransfer type for dragging a list row onto the map. */
export const REL_MIME = 'application/x-io-rel';

export type Show = 'all' | 'none' | 'gps';

/** The files a tab lists; the GPS page also hands this to the Workspace so Select all matches the tab. */
export const showFiles = (entries: EnrichedEntry[], show: Show) => entries.filter((e) => show === 'all' || (show === 'gps') === !!e.meta.gps);

/** The GPS page's side pane: the folder's files with their GPS status. Rows click-select and drag onto the map. */
export function FileList({ api, show, onShow }: { api: WorkspaceApi; show: Show; onShow: (s: Show) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const withGps = api.visible.filter((e) => e.meta.gps).length;
  const counts: Record<Show, number> = { all: api.visible.length, gps: withGps, none: api.visible.length - withGps };
  const rows = showFiles(api.visible, show);
  const focusedRel = api.focused?.rel;

  // Keep the focused file in view, e.g. after picking its marker on the map.
  useEffect(() => {
    if (focusedRel) list.current?.querySelector(`[data-rel="${CSS.escape(focusedRel)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusedRel]);

  return (
    <div className="file-list">
      <div className="file-list-head">
        <div className="seg" role="tablist">
          {(
            [
              ['all', 'All'],
              ['none', 'No GPS'],
              ['gps', 'With GPS'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" className={show === k ? 'active' : ''} onClick={() => onShow(k)}>
              {label} <span className="subtle">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>
      <div ref={list}>
        {rows.length === 0 && <div className="caption muted" style={{ padding: 12 }}>No files.</div>}
        {rows.map((e) => (
          <div
            key={e.rel}
            data-rel={e.rel}
            className={`file-row${api.selectedRels.has(e.rel) ? ' selected' : ''}${focusedRel === e.rel ? ' focused' : ''}`}
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData(REL_MIME, e.rel);
              ev.dataTransfer.setData('text/plain', e.name);
              ev.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={(ev) => api.pick(e.rel, { shift: ev.shiftKey, meta: ev.metaKey || ev.ctrlKey })}
            onContextMenu={(ev) => {
              ev.preventDefault();
              api.openMenu(ev.clientX, ev.clientY, e.rel);
            }}
            title={e.meta.gps ? `${e.meta.gps.lat.toFixed(5)}, ${e.meta.gps.lon.toFixed(5)}` : 'No GPS: select it, choose Place and click the map, or drag it onto the map'}
          >
            <SelectCheck rel={e.rel} checked={api.selectedRels.has(e.rel)} pick={api.pick} />
            <img src={thumbUrl(e, 320)} alt="" loading="lazy" draggable={false} />
            <div className="file-row-text">
              <span className="file-row-name">{e.name}</span>
              <span className="caption subtle">{e.resolved ? formatDisplay(e.resolved.local) : 'No date'}</span>
            </div>
            {!e.meta.gps && <span className="pill pill-warning">No GPS</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
