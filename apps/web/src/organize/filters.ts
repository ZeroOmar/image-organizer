import { DATE_SOURCES, ISSUE_CHECKS, extOf, type EnrichedEntry } from '@io/shared';

/** Facets are computed client-side from the folder listing (libraries are < 10k files). */
export interface FacetDef {
  id: string;
  label: string;
  keys: (e: EnrichedEntry) => string[];
  /** Display label for a key (defaults to the key). */
  labelOf?: (key: string) => string;
  sort?: 'count' | 'key' | 'keyDesc';
}

const round = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d);
const issueLabel = Object.fromEntries(ISSUE_CHECKS.map((c) => [c.id, c.label]));
const sourceLabel = Object.fromEntries(DATE_SOURCES.map((s) => [s.id, s.label]));

export const FACETS: FacetDef[] = [
  { id: 'issues', label: 'Issues', keys: (e) => (e.issues.length ? e.issues.map((i) => i.id) : ['none']), labelOf: (k) => (k === 'none' ? 'No issues' : issueLabel[k] ?? k) },
  { id: 'type', label: 'File Type', keys: (e) => [extOf(e.name).slice(1).toUpperCase() || '?'], sort: 'key' },
  { id: 'kind', label: 'Media', keys: (e) => [e.kind], labelOf: (k) => (k === 'photo' ? 'Photos' : 'Videos') },
  {
    id: 'month',
    label: 'Date (resolved)',
    keys: (e) => [e.resolved ? `${e.resolved.local.y}-${String(e.resolved.local.M).padStart(2, '0')}` : 'none'],
    labelOf: (k) => (k === 'none' ? 'No date' : k),
    sort: 'keyDesc',
  },
  { id: 'source', label: 'Date Source', keys: (e) => [e.resolved?.source ?? 'none'], labelOf: (k) => sourceLabel[k] ?? 'No date' },
  { id: 'offset', label: 'UTC Offset', keys: (e) => [e.resolved?.offset ?? 'none'], labelOf: (k) => (k === 'none' ? 'Unknown' : k), sort: 'key' },
  { id: 'tzSource', label: 'Timezone From', keys: (e) => [e.resolved?.tzSource ?? 'none'], labelOf: (k) => ({ offset: 'File offset', gps: 'GPS', default: 'Default timezone', none: 'Unknown' })[k] ?? k },
  { id: 'gps', label: 'GPS', keys: (e) => [e.meta.gps ? 'yes' : 'no'], labelOf: (k) => (k === 'yes' ? 'Has GPS' : 'No GPS') },
  { id: 'make', label: 'Camera Make', keys: (e) => [e.meta.make ?? 'none'], labelOf: (k) => (k === 'none' ? 'Unknown' : k), sort: 'key' },
  { id: 'model', label: 'Model', keys: (e) => [e.meta.model ?? 'none'], labelOf: (k) => (k === 'none' ? 'Unknown' : k), sort: 'key' },
  {
    id: 'orientation',
    label: 'Orientation',
    keys: (e) => {
      const { width: w, height: h, orientation: o } = e.meta;
      if (!w || !h) return ['unknown'];
      const rotated = o !== undefined && o >= 5 && o <= 8;
      const [W, H] = rotated ? [h, w] : [w, h];
      return [W === H ? 'square' : W > H ? 'landscape' : 'portrait'];
    },
  },
  { id: 'iso', label: 'ISO Speed', keys: (e) => (e.meta.iso ? [String(e.meta.iso)] : []), sort: 'key' },
  { id: 'aperture', label: 'Aperture', keys: (e) => (e.meta.fNumber ? [`f/${round(e.meta.fNumber)}`] : []), sort: 'key' },
  {
    id: 'exposure',
    label: 'Exposure Time',
    keys: (e) => {
      const t = e.meta.exposureTime;
      if (!t) return [];
      return [t >= 1 ? `${round(t)} s` : `1/${Math.round(1 / t)}`];
    },
  },
  { id: 'focal', label: 'Focal Length', keys: (e) => (e.meta.focalLength ? [`${round(e.meta.focalLength)} mm`] : []), sort: 'key' },
  { id: 'focal35', label: 'Focal Length 35mm', keys: (e) => (e.meta.focalLength35 ? [`${round(e.meta.focalLength35, 0)} mm`] : []), sort: 'key' },
];

export type FilterState = Record<string, string[]>;

export interface FacetValue {
  key: string;
  label: string;
  count: number;
}

export function facetValues(entries: EnrichedEntry[]): Record<string, FacetValue[]> {
  const out: Record<string, FacetValue[]> = {};
  for (const f of FACETS) {
    const counts = new Map<string, number>();
    for (const e of entries) for (const k of f.keys(e)) counts.set(k, (counts.get(k) ?? 0) + 1);
    const vals = [...counts].map(([key, count]) => ({ key, count, label: f.labelOf?.(key) ?? key }));
    vals.sort((a, b) =>
      f.sort === 'key'
        ? a.key.localeCompare(b.key, undefined, { numeric: true })
        : f.sort === 'keyDesc'
          ? b.key.localeCompare(a.key)
          : b.count - a.count || a.label.localeCompare(b.label),
    );
    out[f.id] = vals;
  }
  return out;
}

/** OR within a facet, AND across facets. */
export function applyFilters(entries: EnrichedEntry[], state: FilterState): EnrichedEntry[] {
  const active = FACETS.filter((f) => state[f.id]?.length);
  if (!active.length) return entries;
  return entries.filter((e) => active.every((f) => f.keys(e).some((k) => state[f.id].includes(k))));
}

export type SortKey = 'date' | 'name' | 'mtime' | 'size';

export function sortEntries(entries: EnrichedEntry[], key: SortKey, desc: boolean): EnrichedEntry[] {
  const v = (e: EnrichedEntry): number | string =>
    key === 'date' ? (e.resolved?.utcMs ?? Number.MAX_SAFE_INTEGER) : key === 'name' ? e.name.toLowerCase() : key === 'mtime' ? e.mtimeMs : e.size;
  const out = [...entries].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    const c = typeof x === 'string' ? x.localeCompare(y as string, undefined, { numeric: true }) : x - (y as number);
    return c || a.name.localeCompare(b.name);
  });
  return desc ? out.reverse() : out;
}
