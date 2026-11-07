import type { RootName } from '@io/shared';
import { useEffect, useRef, useState } from 'react';
import { useTree } from '../api/hooks';
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from './ContextMenu';

/** Right-click / long-press on a folder (rel '' is the root) at a viewport point. */
export type FolderMenuHandler = (x: number, y: number, rel: string, shiftKey?: boolean) => void;

/** Lazy folder tree: children load when a node is expanded. */
export function FolderTree({
  root,
  selected,
  onSelect,
  rootLabel,
  onMenu,
}: {
  root: RootName;
  selected: string;
  onSelect: (rel: string) => void;
  rootLabel: string;
  onMenu?: FolderMenuHandler;
}) {
  return (
    <div className="tree" role="tree">
      <TreeRow root={root} rel="" name={rootLabel} depth={0} selected={selected} onSelect={onSelect} onMenu={onMenu} initiallyOpen hasChildren />
    </div>
  );
}

function TreeRow({
  root,
  rel,
  name,
  depth,
  selected,
  onSelect,
  onMenu,
  hasChildren,
  initiallyOpen,
}: {
  root: RootName;
  rel: string;
  name: string;
  depth: number;
  selected: string;
  onSelect: (rel: string) => void;
  onMenu?: FolderMenuHandler;
  hasChildren: boolean;
  initiallyOpen?: boolean;
}) {
  // Auto-expand ancestors of the selected folder.
  const [open, setOpen] = useState(initiallyOpen || (rel !== '' && selected.startsWith(`${rel}/`)));
  const children = useTree(root, rel, open && hasChildren);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  return (
    <>
      <div
        className={`tree-row${selected === rel ? ' active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        role="treeitem"
        aria-expanded={hasChildren ? open : undefined}
        aria-selected={selected === rel}
        onClick={() => {
          if (longPressed.current) longPressed.current = false;
          else onSelect(rel);
        }}
        onDoubleClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          if (!onMenu) return;
          e.preventDefault();
          onMenu(e.clientX, e.clientY, rel, e.shiftKey);
        }}
        onPointerDown={(e) => {
          longPressed.current = false;
          cancelPress();
          if (e.pointerType !== 'touch' || !onMenu) return;
          const { clientX: x, clientY: y } = e;
          press.current = {
            x,
            y,
            timer: window.setTimeout(() => {
              press.current = null;
              longPressed.current = true;
              onMenu(x, y, rel);
            }, LONG_PRESS_MS),
          };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
      >
        <span
          className="tree-twisty"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {hasChildren ? (open ? '▼' : '▶') : ''}
        </span>
        <span className="folder-icon" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      </div>
      {open &&
        children.data?.map((c) => (
          <TreeRow
            key={c.rel}
            root={root}
            rel={c.rel}
            name={c.name}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            onMenu={onMenu}
            hasChildren={c.hasChildren}
          />
        ))}
    </>
  );
}
