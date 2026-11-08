import type { EnrichedEntry, FileRef, FolderOp, RootName } from '@io/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useSearchParams } from 'react-router-dom';
import { runJobAndWait, useFolder, useSettings, waitForJob } from '../api/hooks';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { FolderTree } from '../components/FolderTree';
import { ContentGrid } from './ContentGrid';
import { FolderDialog, type FolderDialogKind } from './dialogs/FolderDialogs';
import { FilterPanel } from './FilterPanel';
import { applyFilters, sortEntries, type FilterState, type SortKey } from './filters';
import { MetadataPanel, type MetadataEditing } from './MetadataPanel';
import { PreviewPane } from './PreviewPane';
import { useSelectClick, type PickModifiers, type Selection } from './useSelectClick';

export interface WorkspaceApi {
  root: RootName;
  folder: string;
  /** The Subfolders checkbox: `entries` include files in subfolders. */
  recursive: boolean;
  entries: EnrichedEntry[];
  visible: EnrichedEntry[];
  selected: EnrichedEntry[];
  selection: { files: FileRef[] };
  focused: EnrichedEntry | null;
  /** Selected rels (including files hidden by filters). */
  selectedRels: Selection;
  setSelection: (s: Selection) => void;
  focusRel: (rel: string | null) => void;
  /** Click-select a file like the grid does (modifiers, checkbox toggle); for custom panes. */
  pick: (rel: string, m?: PickModifiers) => void;
  /** Open the right-click / long-press menu for a file (or empty space) at a viewport point; for custom panes. */
  openMenu: (x: number, y: number, rel: string | null) => void;
}

/** A batch action, rendered both as a BatchBar button (via `actionButtons`) and as a context-menu item. */
export interface BatchAction {
  label: string;
  run: () => void;
  variant?: 'primary' | 'danger';
  /** Minimum number of selected files (default 1). */
  min?: number;
  /** Disabled regardless of the selection size (e.g. no videos selected). */
  disabled?: boolean;
}

export function actionButtons(actions: BatchAction[], selected: number) {
  return actions.map((a) => (
    <button
      key={a.label}
      className={`btn btn-sm ${a.variant ? `btn-${a.variant}` : ''}`}
      disabled={a.disabled || selected < (a.min ?? 1)}
      onClick={a.run}
    >
      {a.label}
    </button>
  ));
}

/** An open context menu: where, for which file, and the range action when there is an anchor. */
interface MenuRequest {
  x: number;
  y: number;
  rel: string | null;
  /** Select everything between the last clicked file and this one. */
  selectRange?: () => void;
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
  folderTools,
  batchBar,
  actions,
  onDropFiles,
  emptyText,
  onEditGps,
  content,
  sidePane,
  statusTools,
}: {
  root: RootName;
  rootLabel: string;
  toolbar?: (api: WorkspaceApi) => ReactNode;
  /** Extra controls in the Folders pane header, before the Subfolders checkbox. */
  folderTools?: ReactNode;
  batchBar: (api: WorkspaceApi) => ReactNode;
  /** Batch actions for the right-click / long-press menu on tiles (same list the BatchBar shows). */
  actions?: (api: WorkspaceApi) => BatchAction[];
  onDropFiles?: (folder: string, files: File[]) => void;
  emptyText: string;
  /** Enables inline editing in the Metadata panel; called for "Add location / Edit on map". */
  onEditGps?: (targets: FileRef[], focused: EnrichedEntry) => void;
  /** Replaces the thumbnail grid in the center pane. */
  content?: (api: WorkspaceApi) => ReactNode;
  /** Replaces the Filter pane under the folder tree. */
  sidePane?: { label: string; render: (api: WorkspaceApi) => ReactNode };
  /** Replaces the thumbnail Size slider at the right of the status bar. */
  statusTools?: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  // The open folder lives in ?path=. Remember it per root so switching pages (Organize ↔ GPS ↔ Convert…)
  // comes back to the same folder: a visit without ?path= restores the last one once, on mount.
  const folderKey = `io.${root}.folder`;
  const [restore] = useState(() => {
    if (params.has('path')) return '';
    try {
      return LS?.getItem(folderKey) ?? '';
    } catch {
      return '';
    }
  });
  const restoring = useRef(!!restore);
  const folder = params.get('path') ?? (restoring.current ? restore : '');
  useEffect(() => {
    if (!restoring.current) return;
    restoring.current = false;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (!next.has('path')) next.set('path', restore);
        return next;
      },
      { replace: true },
    );
  }, [restore, setParams]);
  useEffect(() => {
    try {
      if (folder) LS?.setItem(folderKey, folder);
      else LS?.removeItem(folderKey);
    } catch {
      /* storage unavailable */
    }
  }, [folderKey, folder]);
  const [recursive, setRecursive] = useStored(`io.${root}.recursive`, false);
  const [size, setSize] = useStored(`io.thumbSize`, 160);
  const [sort, setSort] = useStored<{ key: SortKey; desc: boolean }>(`io.sort`, { key: 'date', desc: false });
  const [filters, setFilters] = useState<FilterState>({});
  const [selection, setSelection] = useState<Selection>(new Set());
  const [focusedRel, setFocusedRel] = useState<string | null>(null);
  const [leftTab] = useState<'folders'>('folders');
  const [metaTab, setMetaTab] = useState<'summary' | 'all'>('summary');
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; rel: string; shift?: boolean } | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ kind: FolderDialogKind; rel: string; permanent?: boolean } | null>(null);
  const shift = useShiftKey(!!folderMenu, !!folderMenu?.shift);

  const settings = useSettings().data;
  const listing = useFolder(root, folder, recursive);
  const entries = useMemo(() => listing.data?.entries ?? [], [listing.data]);
  const visible = useMemo(() => sortEntries(applyFilters(entries, filters), sort.key, sort.desc), [entries, filters, sort]);
  const byRel = useMemo(() => new Map(entries.map((e) => [e.rel, e])), [entries]);
  const selected = useMemo(() => visible.filter((e) => selection.has(e.rel)), [visible, selection]);
  const focused = (focusedRel && byRel.get(focusedRel)) || selected[0] || null;
  const issueCount = entries.filter((e) => e.issues.length).length;
  const highlight = settings?.issues.enabled ?? true;

  const order = useMemo(() => visible.map((e) => e.rel), [visible]);
  const { pick, selectRange, anchor } = useSelectClick({ order, selection, onSelection: setSelection, onFocus: setFocusedRel });

  const go = (rel: string) => {
    // Keep other params (e.g. the GPS page's ?root=).
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (rel) next.set('path', rel);
      else next.delete('path');
      return next;
    });
    setSelection(new Set());
    setFocusedRel(null);
  };

  // After a folder op, keep showing the same files: follow a renamed/moved folder, leave a deleted one.
  const followFolder = (src: string, op: FolderOp) => {
    if (folder !== src && !folder.startsWith(`${src}/`)) return;
    const rest = folder.slice(src.length);
    const parent = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '';
    const name = src.slice(src.lastIndexOf('/') + 1);
    if (op.type === 'rename') go(`${parent ? `${parent}/` : ''}${op.name}${rest}`);
    else if (op.type === 'move' && op.dest.root === root) go(`${op.dest.rel ? `${op.dest.rel}/` : ''}${name}${rest}`);
    else if (op.type === 'move' || op.type === 'trash' || op.type === 'delete') go(parent);
  };

  const folderMenuItems = (rel: string): MenuItem[] => {
    const open = (kind: FolderDialogKind, permanent?: boolean) => () => setFolderDialog({ kind, rel, permanent });
    const isRoot = rel === '';
    return [
      { label: 'Rename…', onSelect: open('rename'), disabled: isRoot },
      { label: 'Move to…', onSelect: open('move'), disabled: isRoot },
      { label: 'Copy to…', onSelect: open('copy'), disabled: isRoot },
      { label: 'Permissions (chmod)…', onSelect: open('chmod'), separator: true },
      { label: 'Owner (chown)…', onSelect: open('chown') },
      shift
        ? { label: 'Delete permanently…', onSelect: open('trash', true), disabled: isRoot, danger: true, separator: true }
        : { label: 'Move to trash…', onSelect: open('trash'), disabled: isRoot, danger: true, separator: true },
    ];
  };

  // Right-click / long-press (grid tiles and custom panes): a file outside the selection replaces it, like Finder.
  const openMenu = (x: number, y: number, rel: string | null) => {
    if (!actions) return;
    let base = selection;
    if (rel && !selection.has(rel)) {
      base = new Set([rel]);
      setSelection(base);
    }
    if (rel) setFocusedRel(rel);
    const from = anchor.current;
    setMenu({
      x,
      y,
      rel,
      selectRange: rel && from && from !== rel && order.includes(from) ? () => selectRange(rel, base) : undefined,
    });
    if (rel) anchor.current = rel;
  };

  const api: WorkspaceApi = {
    root,
    folder,
    recursive,
    entries,
    visible,
    selected,
    selection: { files: selected.map((e) => ({ root: e.root, rel: e.rel })) },
    focused,
    selectedRels: selection,
    setSelection,
    focusRel: setFocusedRel,
    pick,
    openMenu,
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

  const menuItems = (req: MenuRequest): MenuItem[] => [
    ...(actions?.(api) ?? []).map((a) => ({
      label: a.label,
      onSelect: a.run,
      disabled: a.disabled || selected.length < (a.min ?? 1),
      danger: a.variant === 'danger',
    })),
    { label: 'Select all', onSelect: () => setSelection(new Set(visible.map((e) => e.rel))), separator: true },
    ...(req.selectRange ? [{ label: 'Select range to here', onSelect: req.selectRange }] : []),
    { label: 'Clear selection', onSelect: () => setSelection(new Set()), disabled: selection.size === 0 },
  ];

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
                  <div className="pane-head-tools">
                    {folderTools}
                    <label className="check caption" title="Include files in subfolders">
                      <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
                      Subfolders
                    </label>
                  </div>
                </div>
                <div className="pane-body">
                  <FolderTree root={root} selected={folder} onSelect={go} rootLabel={rootLabel} onMenu={root === 'trash' ? undefined : (x, y, rel, shift) => setFolderMenu({ x, y, rel, shift })} />
                </div>
              </div>
            </Panel>
            <Separator />
            <Panel id="filter" minSize="80px">
              <div className="pane">
                <div className="pane-head">
                  <button className="tab active">{sidePane?.label ?? 'Filter'}</button>
                </div>
                <div className="pane-body">
                  {sidePane ? sidePane.render(api) : <FilterPanel entries={entries} state={filters} onChange={setFilters} />}
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
            ) : content ? (
              content(api)
            ) : (
              <ContentGrid
                entries={visible}
                selection={selection}
                onSelection={setSelection}
                focused={focused?.rel ?? null}
                pick={pick}
                size={size}
                highlight={highlight}
                onDropFiles={onDropFiles ? (files) => onDropFiles(folder, files) : undefined}
                onMenu={actions ? openMenu : undefined}
                empty={listing.isLoading ? 'Reading metadata…' : entries.length ? 'No files match the filters.' : emptyText}
              />
            )}
            {folderMenu && (
              <ContextMenu
                x={folderMenu.x}
                y={folderMenu.y}
                title={folderMenu.rel ? folderMenu.rel.split('/').pop() : rootLabel}
                items={folderMenuItems(folderMenu.rel)}
                onClose={() => setFolderMenu(null)}
              />
            )}
            {folderDialog && (
              <FolderDialog
                kind={folderDialog.kind}
                folder={{ root, rel: folderDialog.rel }}
                permanent={folderDialog.permanent}
                onClose={() => setFolderDialog(null)}
                onApplied={(op, jobId) => {
                  const src = folderDialog.rel;
                  void waitForJob(jobId).then((j) => j.status === 'done' && followFolder(src, op));
                }}
              />
            )}
            {menu && (
              <ContextMenu
                x={menu.x}
                y={menu.y}
                title={selected.length ? `${selected.length} selected` : undefined}
                items={menuItems(menu)}
                onClose={() => setMenu(null)}
              />
            )}
            <div className="batchbar">{batchBar(api)}</div>
            <div className="statusbar">
              <span>
                {visible.length} item{visible.length === 1 ? '' : 's'}
                {visible.length !== entries.length && ` (${entries.length - visible.length} hidden)`}
                {selected.length > 0 && `, ${selected.length} selected`}
              </span>
              {visible.length > 0 && selected.length < visible.length && (
                <button className="link-btn" onClick={() => setSelection(new Set(visible.map((e) => e.rel)))}>
                  Select all
                </button>
              )}
              {selection.size > 0 && (
                <button className="link-btn" onClick={() => setSelection(new Set())}>
                  Clear
                </button>
              )}
              {highlight && issueCount > 0 && <span className="warning-text">{issueCount} with issues</span>}
              {listing.isFetching && <span className="subtle">Refreshing…</span>}
              <span className="grow" />
              {statusTools ?? (
                <>
                  <span className="subtle">Size</span>
                  <input type="range" min={110} max={340} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Thumbnail size" />
                </>
              )}
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
                  <PreviewPane entry={focused} selected={selected} />
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

/** Whether Shift is held (while `active`): the folder menu offers "Delete permanently" instead of trash. */
function useShiftKey(active: boolean, initial: boolean): boolean {
  const [down, setDown] = useState(initial);
  useEffect(() => {
    setDown(active && initial);
    if (!active) return;
    const on = (e: KeyboardEvent) => setDown(e.shiftKey);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
    };
  }, [active, initial]);
  return down;
}
