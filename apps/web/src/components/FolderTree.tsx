import type { RootName } from '@io/shared';
import { useState } from 'react';
import { useTree } from '../api/hooks';

/** Lazy folder tree: children load when a node is expanded. */
export function FolderTree({
  root,
  selected,
  onSelect,
  rootLabel,
}: {
  root: RootName;
  selected: string;
  onSelect: (rel: string) => void;
  rootLabel: string;
}) {
  return (
    <div className="tree" role="tree">
      <TreeRow root={root} rel="" name={rootLabel} depth={0} selected={selected} onSelect={onSelect} initiallyOpen hasChildren />
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
  hasChildren,
  initiallyOpen,
}: {
  root: RootName;
  rel: string;
  name: string;
  depth: number;
  selected: string;
  onSelect: (rel: string) => void;
  hasChildren: boolean;
  initiallyOpen?: boolean;
}) {
  // Auto-expand ancestors of the selected folder.
  const [open, setOpen] = useState(initiallyOpen || (rel !== '' && selected.startsWith(`${rel}/`)));
  const children = useTree(root, rel, open && hasChildren);
  return (
    <>
      <div
        className={`tree-row${selected === rel ? ' active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        role="treeitem"
        aria-expanded={hasChildren ? open : undefined}
        aria-selected={selected === rel}
        onClick={() => onSelect(rel)}
        onDoubleClick={() => setOpen((o) => !o)}
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
            hasChildren={c.hasChildren}
          />
        ))}
    </>
  );
}
