import {
  COPY_GROUPS,
  STEP_INFO,
  baseOf,
  formatDisplay,
  formatExifDate,
  formatOffset,
  isValidZone,
  parseIsoLocal,
  parseTemplate,
  planRenames,
  renderContext,
  resolveDate,
  utcToWallInZone,
  wallInZoneToUtc,
  zoneOffsetMinutes,
  type CopyGroup,
  type FileRef,
  type MediaEntry,
  type PlanItem,
  type RenameInput,
  type ResolvedDate,
  type Selection,
  type Settings,
  type Step,
  type Wall,
} from '@io/shared';
import { listDir, walkFiles } from '../fs/ops.js';
import { dirOfRel, joinRel, nameOfRel, type Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';
import { tzForGps, type Indexer } from '../index/indexer.js';
import { TAG_NAME, type TagMap } from '../metadata/exiftool.js';
import { applyDateToMeta, clearGpsTags, dateTags, gpsSnapshotTags, gpsTags } from '../metadata/tags.js';

/** Concrete filesystem/metadata operations. Executed in order by the engine. */
export type Op =
  | { op: 'writeTags'; step: number; file: FileRef; tags: TagMap; numeric?: boolean; snapshot: string[] }
  | { op: 'copyTags'; step: number; file: FileRef; source: FileRef; tags: string[] }
  | { op: 'rename'; step: number; file: FileRef; to: FileRef }
  | { op: 'move'; step: number; file: FileRef; to: FileRef }
  | { op: 'utimes'; step: number; file: FileRef; mtimeMs: number }
  | { op: 'trash'; step: number; file: FileRef };

export interface Plan {
  ops: Op[];
  items: PlanItem[];
  warnings: string[];
  fileCount: number;
}

/** A file as it will be after the steps planned so far (dry-run simulation). */
interface VFile {
  orig: FileRef;
  cur: FileRef;
  entry: MediaEntry;
  trashed: boolean;
}

export interface PlannerDeps {
  roots: Roots;
  indexer: Indexer;
  settings: Settings;
  defaultTz: string;
}

export async function expandSelection(sel: Selection, roots: Roots): Promise<FileRef[]> {
  let refs: FileRef[];
  if ('files' in sel) refs = sel.files.map((f) => ({ root: f.root, rel: roots.resolve(f).rel }));
  else {
    const dir = roots.resolve(sel.folder);
    if (sel.recursive) refs = (await walkFiles(dir.abs, dir.rel)).map((rel) => ({ root: dir.root, rel }));
    else refs = (await listDir(dir.abs)).files.map((f) => ({ root: dir.root, rel: joinRel(dir.rel, f.name) }));
  }
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (r.root === 'trash') throw new HttpError(400, 'Files in the trash can only be restored or deleted');
    const k = `${r.root}:${r.rel}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function planJob(refs: FileRef[], steps: Step[], deps: PlannerDeps): Promise<Plan> {
  const entries = await deps.indexer.getEntries(refs);
  const plan: Plan = { ops: [], items: [], warnings: [], fileCount: entries.length };
  if (entries.length < refs.length) plan.warnings.push(`${refs.length - entries.length} file(s) could not be read and were skipped`);
  const files: VFile[] = entries.map((e) => ({ orig: { root: e.root, rel: e.rel }, cur: { root: e.root, rel: e.rel }, entry: e, trashed: false }));
  for (let i = 0; i < steps.length; i++) await planStep(i, steps[i], files.filter((f) => !f.trashed), plan, deps);
  return plan;
}

const resolved = (v: VFile, d: PlannerDeps) => resolveDate(v.entry, d.settings.dateSources, d.defaultTz);
const showDate = (r: ResolvedDate | null) => (r ? `${formatDisplay(r.local)} ${r.offset}` : '—');

function setCur(v: VFile, to: FileRef) {
  v.cur = to;
  v.entry = { ...v.entry, root: to.root, rel: to.rel, name: nameOfRel(to.rel) };
}

async function planStep(step: number, s: Step, files: VFile[], plan: Plan, d: PlannerDeps): Promise<void> {
  const item = (v: VFile, extra: Omit<PlanItem, 'file' | 'step' | 'action'> & { action?: string }) =>
    plan.items.push({ file: v.orig, step, action: STEP_INFO[s.type].label, ...extra });

  const writeDate = (v: VFile, local: Wall, tz: string, utcMs: number) => {
    const offset = formatOffset(zoneOffsetMinutes(tz, utcMs));
    const before = resolved(v, d);
    const tags = dateTags(v.entry.kind, local, offset, utcMs);
    const meta = v.entry.meta;
    const unchanged =
      v.entry.kind === 'photo'
        ? // ExifTool may print sub-seconds ("…:04.100"); compare to the second.
          meta.dateTimeOriginal?.slice(0, 19) === formatExifDate(local) && meta.offsetTimeOriginal === offset
        : meta.qtCreationDate === `${formatExifDate(local)}${offset}` && meta.qtCreateDate?.slice(0, 19) === tags['QuickTime:CreateDate'];
    if (unchanged) return;
    plan.ops.push({ op: 'writeTags', step, file: { ...v.cur }, tags, snapshot: Object.keys(tags) });
    item(v, { before: showDate(before), after: `${formatDisplay(local)} ${offset}` });
    v.entry = { ...v.entry, meta: applyDateToMeta(v.entry.kind, meta, local, offset, utcMs) };
  };

  switch (s.type) {
    case 'applyDates':
      for (const v of files) {
        const r = resolved(v, d);
        if (!r) item(v, { error: 'No date found in any source' });
        else writeDate(v, r.local, r.tz, r.utcMs);
      }
      return;

    case 'shiftDates':
      for (const v of files) {
        const r = resolved(v, d);
        if (!r) {
          item(v, { error: 'No date to shift' });
          continue;
        }
        const utc = r.utcMs + s.seconds * 1000;
        writeDate(v, utcToWallInZone(utc, r.tz), r.tz, utc);
      }
      return;

    case 'setDate': {
      const wall = parseIsoLocal(s.local);
      if (!wall) throw new HttpError(400, `Invalid date: ${s.local}`);
      if (!isValidZone(s.tz)) throw new HttpError(400, `Unknown timezone: ${s.tz}`);
      for (const v of files) writeDate(v, wall, s.tz, wallInZoneToUtc(wall, s.tz));
      return;
    }

    case 'setTimezone':
      if (!isValidZone(s.tz)) throw new HttpError(400, `Unknown timezone: ${s.tz}`);
      for (const v of files) {
        const r = resolved(v, d);
        if (!r) {
          item(v, { error: 'No date found' });
          continue;
        }
        if (s.keep === 'wall') writeDate(v, r.local, s.tz, wallInZoneToUtc(r.local, s.tz));
        else writeDate(v, utcToWallInZone(r.utcMs, s.tz), s.tz, r.utcMs);
      }
      return;

    case 'rename': {
      for (const kind of ['photo', 'video'] as const) {
        const t = s.templates?.[kind] ?? d.settings.rename.templates[kind];
        const errs = parseTemplate(t).errors;
        if (errs.length) throw new HttpError(400, `${kind} template: ${errs.join('; ')}`);
      }
      const byDir = new Map<string, VFile[]>();
      for (const v of files) {
        const k = `${v.cur.root}\u0000${dirOfRel(v.cur.rel)}`;
        byDir.set(k, [...(byDir.get(k) ?? []), v]);
      }
      for (const [k, group] of byDir) {
        const [root, dir] = k.split('\u0000') as [FileRef['root'], string];
        const listing = await listDir(d.roots.resolve({ root, rel: dir }).abs).catch(() => null);
        const existing = new Set(listing?.allNames ?? []);
        for (const v of group) existing.delete(v.entry.name.toLowerCase());
        const inputs: RenameInput[] = [];
        const byId = new Map<string, VFile>();
        group.forEach((v, idx) => {
          const r = resolved(v, d);
          if (!r) return item(v, { error: 'No date found, cannot rename' });
          const id = String(idx);
          byId.set(id, v);
          const ctx = renderContext({ name: v.entry.name, kind: v.entry.kind, folder: nameOfRel(dir), make: v.entry.meta.make, model: v.entry.meta.model }, r, d.settings);
          inputs.push({ id, dir, name: v.entry.name, kind: v.entry.kind, ctx, sortKey: r.utcMs });
        });
        const names = planRenames(inputs, new Map([[dir, existing]]), d.settings, s.templates);
        for (const [id, newName] of names) {
          const v = byId.get(id)!;
          if (newName === v.entry.name) continue;
          const to = { root, rel: joinRel(dir, newName) };
          plan.ops.push({ op: 'rename', step, file: { ...v.cur }, to });
          item(v, { before: v.entry.name, after: newName });
          setCur(v, to);
        }
      }
      return;
    }

    case 'syncFileDates':
      for (const v of files) {
        const r = resolved(v, d);
        if (!r) {
          item(v, { error: 'No date found' });
          continue;
        }
        if (Math.abs(r.utcMs - v.entry.mtimeMs) < 1000) continue;
        plan.ops.push({ op: 'utimes', step, file: { ...v.cur }, mtimeMs: r.utcMs });
        item(v, { before: new Date(v.entry.mtimeMs).toISOString(), after: new Date(r.utcMs).toISOString() });
        v.entry = { ...v.entry, mtimeMs: r.utcMs };
      }
      return;

    case 'setGps':
    case 'clearGps':
      for (const v of files) {
        const kind = v.entry.kind;
        const point = s.type === 'setGps' ? { lat: s.lat, lon: s.lon, alt: s.alt ?? null } : undefined;
        const { tags, numeric } = point ? gpsTags(kind, point) : clearGpsTags(kind);
        plan.ops.push({ op: 'writeTags', step, file: { ...v.cur }, tags, numeric, snapshot: gpsSnapshotTags(kind) });
        const g = v.entry.meta.gps;
        item(v, { before: g ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}` : '—', after: point ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}` : '—' });
        v.entry = { ...v.entry, meta: { ...v.entry.meta, gps: point }, gpsTz: tzForGps(point) };
      }
      return;

    case 'copyMetadata': {
      const src = await d.indexer.getEntry(s.source);
      const groups = s.groups.filter((g): g is CopyGroup => g in COPY_GROUPS);
      const plain = [...new Set([...groups.filter((g) => g !== 'dates' && g !== 'gps').flatMap((g) => [...COPY_GROUPS[g].tags]), ...s.tags])];
      const bad = plain.filter((t) => !TAG_NAME.test(t));
      if (bad.length) throw new HttpError(400, `Invalid tag name(s): ${bad.join(', ')}`);
      const srcDate = groups.includes('dates') ? resolveDate(src, d.settings.dateSources, d.defaultTz) : null;
      if (groups.includes('dates') && !srcDate) plan.warnings.push('The source file has no date to copy');
      if (groups.includes('gps') && !src.meta.gps) plan.warnings.push('The source file has no GPS position to copy');
      for (const v of files) {
        if (v.cur.root === src.root && v.cur.rel === src.rel) continue;
        if (srcDate) writeDate(v, srcDate.local, srcDate.tz, srcDate.utcMs);
        if (groups.includes('gps') && src.meta.gps) {
          const { tags, numeric } = gpsTags(v.entry.kind, src.meta.gps);
          plan.ops.push({ op: 'writeTags', step, file: { ...v.cur }, tags, numeric, snapshot: gpsSnapshotTags(v.entry.kind) });
          item(v, { action: 'Copy GPS', after: `${src.meta.gps.lat.toFixed(5)}, ${src.meta.gps.lon.toFixed(5)}` });
          v.entry = { ...v.entry, meta: { ...v.entry.meta, gps: src.meta.gps }, gpsTz: tzForGps(src.meta.gps) };
        }
        if (plain.length) {
          plan.ops.push({ op: 'copyTags', step, file: { ...v.cur }, source: { root: src.root, rel: src.rel }, tags: plain });
          item(v, { action: 'Copy tags', after: plain.join(', ') });
        }
      }
      return;
    }

    case 'editTags': {
      const bad = Object.keys(s.tags).filter((t) => !TAG_NAME.test(t));
      if (bad.length) throw new HttpError(400, `Invalid tag name(s): ${bad.join(', ')}`);
      const summary = Object.entries(s.tags)
        .map(([k, val]) => `${k} = ${val === null ? '(delete)' : Array.isArray(val) ? val.join('; ') : val}`)
        .join(', ');
      for (const v of files) {
        plan.ops.push({ op: 'writeTags', step, file: { ...v.cur }, tags: s.tags, snapshot: Object.keys(s.tags) });
        item(v, { after: summary });
      }
      return;
    }

    case 'move':
      if (s.dest.root === 'trash') throw new HttpError(400, 'Use Trash to delete files');
      await planMoves(files, () => ({ root: s.dest.root, rel: d.roots.resolve(s.dest).rel }), step, plan, d, item);
      return;

    case 'moveByDate': {
      const segs = s.pattern.split('/').filter(Boolean);
      if (!segs.length || segs.some((p) => p === '..' || p === '.')) throw new HttpError(400, 'Invalid folder pattern');
      await planMoves(
        files,
        (v) => {
          const r = resolved(v, d);
          if (!r) return null;
          const pad = (n: number, w = 2) => String(n).padStart(w, '0');
          const rel = segs
            .map((seg) =>
              seg
                .replace(/\{YYYY\}/g, pad(r.local.y, 4))
                .replace(/\{YY\}/g, pad(r.local.y % 100))
                .replace(/\{MM\}/g, pad(r.local.M))
                .replace(/\{DD\}/g, pad(r.local.d))
                .replace(/\{TYPE\}/g, d.settings.rename.typeLabels[v.entry.kind]),
            )
            .join('/');
          return { root: 'media', rel: d.roots.resolve({ root: 'media', rel }).rel };
        },
        step,
        plan,
        d,
        item,
      );
      return;
    }

    case 'trash':
      for (const v of files) {
        plan.ops.push({ op: 'trash', step, file: { ...v.cur } });
        item(v, { before: v.cur.rel, after: 'Trash' });
        v.trashed = true;
      }
      return;
  }
}

/** Moves never overwrite: a taken name becomes name_1.ext, name_2.ext … */
async function planMoves(
  files: VFile[],
  destOf: (v: VFile) => FileRef | null,
  step: number,
  plan: Plan,
  d: PlannerDeps,
  item: (v: VFile, extra: Partial<PlanItem>) => void,
): Promise<void> {
  const taken = new Map<string, Set<string>>();
  for (const v of files) {
    const dest = destOf(v);
    if (!dest) {
      item(v, { error: 'No date found for the destination folder' });
      continue;
    }
    if (dest.root !== v.cur.root && !(v.cur.root === 'import' && dest.root === 'media')) {
      item(v, { error: `Moving from ${v.cur.root} to ${dest.root} is not allowed` });
      continue;
    }
    if (dest.root === v.cur.root && dest.rel === dirOfRel(v.cur.rel)) continue;
    const key = `${dest.root}\u0000${dest.rel}`;
    let names = taken.get(key);
    if (!names) {
      const listing = await listDir(d.roots.resolve(dest).abs).catch(() => null);
      taken.set(key, (names = new Set(listing?.allNames ?? [])));
    }
    const name = v.entry.name;
    let candidate = name;
    for (let i = 1; names.has(candidate.toLowerCase()); i++) candidate = `${baseOf(name)}_${i}${name.slice(baseOf(name).length)}`;
    names.add(candidate.toLowerCase());
    const to = { root: dest.root, rel: joinRel(dest.rel, candidate) };
    plan.ops.push({ op: 'move', step, file: { ...v.cur }, to });
    item(v, { before: `${v.cur.root}/${v.cur.rel}`, after: `${to.root}/${to.rel}` });
    setCur(v, to);
  }
}
