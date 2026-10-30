import type { EnrichedEntry, FileRef, RootName } from '@io/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useSearchParams } from 'react-router-dom';
import { runJobAndWait, useFolder, useSettings } from '../api/hooks';
import { FolderTree } from '../components/FolderTree';
import { ContentGrid, type Selection } from './ContentGrid';
import { FilterPanel } from './FilterPanel';
import { applyFilters, sortEntries, type FilterState, type SortKey } from './filters';
import { MetadataPanel, type MetadataEditing } from './MetadataPanel';
import { PreviewPane } from './PreviewPane';

export interface WorkspaceApi {
  root: RootName;
  folder: string;
  entries: EnrichedEntry[];
  visible: EnrichedEntry[];
  selected: EnrichedEntry[];
  selection: { files: FileRef[] };
  focused: EnrichedEntry | null;
}

const LS = typeof window !== 'undefined' ? window.localStorage : undefined;

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = LS?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        LS?.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    },
  ];
}

/**
 * Bridge-style layout shared by Organize and Import: Folders + Filter | Content | Preview + Metadata.
 * Every split is resizable; sizes persist per page in localStorage.
 */
export function Workspace({
  root,
  rootLabel,
  toolbar,
  batchBar,
  onDropFiles,
  emptyText,
  onEditGps,
}: {
  root: RootName;
  rootLabel: string;
  toolbar?: (api: WorkspaceApi) => ReactNode;
  batchBar: (api: WorkspaceApi) => ReactNode;
  onDropFiles?: (folder: string, files: File[]) => void;
  emptyText: string;
  /** Enables inline editing in the Metadata panel; called for "Add location / Edit on map". */
  onEditGps?: (targets: FileRef[], focused: EnrichedEntry) => void;
}) {
  const [params, setParams] = useSearchParams();
  const folder = params.get('path') ?? '';
  const [recursive, setRecursive] = useStored(`io.${root}.recursive`, false);
  const [size, setSize] = useStored(`io.thumbSize`, 160);
  const [sort, setSort] = useStored<{ key: SortKey; desc: boolean }>(`io.sort`, { key: 'date', desc: false });
  const [filters, setFilters] = useState<FilterState>({});
  const [selection, setSelection] = useState<Selection>(new Set());
  const [focusedRel, setFocusedRel] = useState<string | null>(null);
  const [leftTab] = useState<'folders'>('folders');
  const [metaTab, setMetaTab] = useState<'summary' | 'all'>('summary');

  const settings = useSettings().data;
  const listing = useFolder(root, folder, recursive);
  const entries = useMemo(() => listing.data?.entries ?? [], [listing.data]);
  const visible = useMemo(() => sortEntries(applyFilters(entries, filters), sort.key, sort.desc), [entries, filters, sort]);
  const byRel = useMemo(() => new Map(entries.map((e) => [e.rel, e])), [entries]);
  const selected = useMemo(() => visible.filter((e) => selection.has(e.rel)), [visible, selection]);
  const focused = (focusedRel && byRel.get(focusedRel)) || selected[0] || null;
  const issueCount = entries.filter((e) => e.issues.length).length;
  const highlight = settings?.issues.enabled ?? true;

  const go = (rel: string) => {
    setParams(rel ? { path: rel } : {});
    setSelection(new Set());
    setFocusedRel(null);
  };

  const api: WorkspaceApi = {
    root,
    folder,
    entries,
    visible,
    selected,
    selection: { files: selected.map((e) => ({ root: e.root, rel: e.rel })) },
    focused,
  };

  // Like Bridge: edits in the Metadata panel apply to the whole selection when it includes the shown file.
  const editTargets: FileRef[] = focused
    ? selection.has(focused.rel)
      ? api.selection.files
      : [{ root: focused.root, rel: focused.rel }]
    : [];
  const metaEditing: MetadataEditing | undefined =
    onEditGps && focused
      ? {
          targets: editTargets.length,
          onEditGps: () => onEditGps(editTargets, focused),
          onEditTag: async (tag, value) => {
            await runJobAndWait({
              title: `Edit ${tag}${editTargets.length > 1 ? ` on ${editTargets.length} files` : ''}`,
              selection: { files: editTargets },
              steps: [{ type: 'editTags', tags: { [tag]: value } }],
            });
          },
        }
      : undefined;

  const h = useDefaultLayout({ id: `io-${root}-h`, storage: localStorage });
  const l = useDefaultLayout({ id: `io-${root}-left`, storage: localStorage });
  const r = useDefaultLayout({ id: `io-${root}-right`, storage: localStorage });
  const crumbs = folder ? folder.split('/') : [];

  return (
    <div className="workspace">
      <Group orientation="horizontal" id={`io-${root}-h`} defaultLayout={h.defaultLayout} onLayoutChanged={h.onLayoutChanged}>
        <Panel id="left" defaultSize="20%" minSize="170px">
          <Group orientation="vertical" id={`io-${root}-left`} defaultLayout={l.defaultLayout} onLayoutChanged={l.onLayoutChanged}>
            <Panel id="folders" defaultSize="45%" minSize="80px">
              <div className="pane">
                <div className="pane-head">
                  <button className={`tab ${leftTab === 'folders' ? 'active' : ''}`}>Folders</button>
                </div>
                <div className="pane-body">
                  <FolderTree root={root} selected={folder} onSelect={go} rootLabel={rootLabel} />
                </div>
              </div>
            </Panel>
            <Separator />
            <Panel id="filter" minSize="80px">
              <div className="pane">
                <div className="pane-head">
                  <button className="tab active">Filter</button>
                </div>
                <div className="pane-body">
                  <FilterPanel entries={entries} state={filters} onChange={setFilters} />
                </div>
              </div>
            </Panel>
          </Group>
        </Panel>
        <Separator />
        <Panel id="center" minSize="320px">
          <div className="pane">
            <div className="content-toolbar">
              <div className="crumbs grow">
                <button onClick={() => go('')}>{rootLabel}</button>
                {crumbs.map((c, i) => (
                  <span key={i} className="row" style={{ gap: 4 }}>
                    <span className="sep">›</span>
                    <button onClick={() => go(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                  </span>
                ))}
              </div>
              {toolbar?.(api)}
              <label className="check caption" title="Include files in subfolders">
                <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
                Subfolders
              </label>
              <select
                className="input"
                style={{ width: 'auto', minHeight: 28, padding: '2px 8px', fontSize: 13 }}
                value={`${sort.key}:${sort.desc ? 'desc' : 'asc'}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(':');
                  setSort({ key: key as SortKey, desc: dir === 'desc' });
                }}
                aria-label="Sort"
              >
                <option value="date:asc">Date ↑</option>
                <option value="date:desc">Date ↓</option>
                <option value="name:asc">Name A–Z</option>
                <option value="name:desc">Name Z–A</option>
                <option value="mtime:desc">File date ↓</option>
                <option value="size:desc">Size ↓</option>
              </select>
            </div>
            {listing.error ? (
              <div className="empty error-text">{(listing.error as Error).message}</div>
            ) : (
              <ContentGrid
                entries={visible}
                selection={selection}
                onSelection={setSelection}
                focused={focused?.rel ?? null}
                onFocus={setFocusedRel}
                size={size}
                highlight={highlight}
                onDropFiles={onDropFiles ? (files) => onDropFiles(folder, files) : undefined}
                empty={listing.isLoading ? 'Reading metadata…' : entries.length ? 'No files match the filters.' : emptyText}
              />
            )}
            <div className="batchbar">{batchBar(api)}</div>
            <div className="statusbar">
              <span>
                {visible.length} item{visible.length === 1 ? '' : 's'}
                {visible.length !== entries.length && ` (${entries.length - visible.length} hidden)`}
                {selected.length > 0 && `, ${selected.length} selected`}
              </span>
              {highlight && issueCount > 0 && <span className="warning-text">{issueCount} with issues</span>}
              {listing.isFetching && <span className="subtle">Refreshing…</span>}
              <span className="grow" />
              <span className="subtle">Size</span>
              <input type="range" min={110} max={340} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Thumbnail size" />
            </div>
          </div>
        </Panel>
        <Separator />
        <Panel id="right" defaultSize="27%" minSize="220px">
          <Group orientation="vertical" id={`io-${root}-right`} defaultLayout={r.defaultLayout} onLayoutChanged={r.onLayoutChanged}>
            <Panel id="preview" defaultSize="45%" minSize="100px">
              <div className="pane">
                <div className="pane-head">
                  <button className="tab active">Preview</button>
                </div>
                <div className="pane-body" style={{ overflow: 'hidden' }}>
                  <PreviewPane entry={focused} />
                </div>
              </div>
            </Panel>
            <Separator />
            <Panel id="metadata" minSize="100px">
              <div className="pane">
                <div className="pane-head">
                  <button className={`tab ${metaTab === 'summary' ? 'active' : ''}`} onClick={() => setMetaTab('summary')}>
                    Metadata
                  </button>
                  <button className={`tab ${metaTab === 'all' ? 'active' : ''}`} onClick={() => setMetaTab('all')}>
                    All tags
                  </button>
                </div>
                <div className="pane-body">
                  <MetadataPanel key={focused?.rel} entry={focused} tab={metaTab} editing={metaEditing} />
                </div>
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
