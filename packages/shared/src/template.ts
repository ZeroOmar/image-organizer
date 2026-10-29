import { formatOffset, type ResolvedDate, type Wall } from './dates.js';
import { baseOf, extOf, type MediaKind } from './media.js';
import type { Settings } from './settings.js';

export const TEMPLATE_TOKENS: { token: string; description: string; example: string }[] = [
  { token: 'YYYY', description: 'Year, 4 digits', example: '2026' },
  { token: 'YY', description: 'Year, 2 digits', example: '26' },
  { token: 'MM', description: 'Month 01-12', example: '10' },
  { token: 'DD', description: 'Day 01-31', example: '08' },
  { token: 'HH', description: 'Hour 00-23', example: '09' },
  { token: 'mm', description: 'Minute', example: '40' },
  { token: 'ss', description: 'Second', example: '04' },
  { token: 'SSS', description: 'Milliseconds', example: '120' },
  { token: 'XX', description: 'Conflict counter, empty when the name is unique', example: '01' },
  { token: 'TYPE', description: 'Type label (PIC / VID, set below)', example: 'PIC' },
  { token: 'orig', description: 'Original file name without extension', example: 'IMG_1234' },
  { token: 'make', description: 'Camera make', example: 'INFINIX' },
  { token: 'model', description: 'Camera model', example: 'X6833B' },
  { token: 'folder', description: 'Name of the containing folder', example: 'Bikers' },
  { token: 'tz', description: 'UTC offset, e.g. +0300', example: '+0300' },
];

const KNOWN = new Set(TEMPLATE_TOKENS.map((t) => t.token));
const DATE_TOKENS = new Set(['YYYY', 'YY', 'MM', 'DD', 'HH', 'mm', 'ss', 'SSS']);
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f]/;

export type TemplatePart = { lit: string } | { tok: string };

export interface ParsedTemplate {
  parts: TemplatePart[];
  errors: string[];
  hasCounter: boolean;
}

export function parseTemplate(template: string): ParsedTemplate {
  const parts: TemplatePart[] = [];
  const errors: string[] = [];
  const re = /\{([A-Za-z]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m.index > last) parts.push({ lit: template.slice(last, m.index) });
    if (!KNOWN.has(m[1])) errors.push(`Unknown token {${m[1]}}`);
    parts.push({ tok: m[1] });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ lit: template.slice(last) });
  for (const p of parts) {
    if ('lit' in p && /[{}]/.test(p.lit)) errors.push(`Unbalanced brace in "${p.lit}"`);
    if ('lit' in p && ILLEGAL.test(p.lit)) errors.push(`Illegal character in "${p.lit}" (no / \\ : * ? " < > |)`);
  }
  if (!template.trim()) errors.push('Template is empty');
  const toks = parts.flatMap((p) => ('tok' in p ? [p.tok] : []));
  if (!toks.some((t) => DATE_TOKENS.has(t) || t === 'orig')) errors.push('Template needs at least one date token or {orig}');
  return { parts, errors, hasCounter: toks.includes('XX') };
}

export interface RenderContext {
  local: Wall;
  offset: string;
  typeLabel: string;
  orig: string;
  make?: string;
  model?: string;
  folder: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function clean(s: string | undefined): string {
  return (s ?? '').replace(ILLEGAL, '_').replace(/\s+/g, '_').trim();
}

export function renderParts(parts: TemplatePart[], ctx: RenderContext, counter: string): string {
  const w = ctx.local;
  const v: Record<string, string> = {
    YYYY: pad(w.y, 4),
    YY: pad(w.y % 100),
    MM: pad(w.M),
    DD: pad(w.d),
    HH: pad(w.h),
    mm: pad(w.m),
    ss: pad(w.s),
    SSS: pad(w.ms, 3),
    XX: counter,
    TYPE: ctx.typeLabel,
    orig: ctx.orig,
    make: clean(ctx.make),
    model: clean(ctx.model),
    folder: clean(ctx.folder),
    tz: ctx.offset.replace(':', ''),
  };
  let out = parts.map((p) => ('lit' in p ? p.lit : v[p.tok] ?? '')).join('');
  // A template without {XX} still needs a way to disambiguate: append the counter.
  if (counter && !parts.some((p) => 'tok' in p && p.tok === 'XX')) out += `_${counter}`;
  return out;
}

export function normalizeExtension(name: string, settings: Settings): string {
  const raw = name.slice(baseOf(name).length);
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const mapped = settings.extensions.map[lower];
  if (mapped) return mapped;
  return settings.extensions.lowercase ? lower : raw;
}

export function renderContext(
  file: { name: string; kind: MediaKind; folder: string; make?: string; model?: string },
  resolved: Pick<ResolvedDate, 'local' | 'offset'>,
  settings: Settings,
): RenderContext {
  return {
    local: resolved.local,
    offset: resolved.offset,
    typeLabel: settings.rename.typeLabels[file.kind],
    orig: baseOf(file.name),
    make: file.make,
    model: file.model,
    folder: file.folder,
  };
}

export interface RenameInput {
  id: string;
  dir: string;
  name: string;
  kind: MediaKind;
  ctx: RenderContext;
  /** Orders files that share a name: capture instant (with ms), then current name. */
  sortKey: number;
}

/**
 * Compute new names for a batch. Files that resolve to the same name are ALL numbered from
 * `counter.start` (094004 → 09400401, 09400402 …); a unique name gets an empty counter.
 * `existing` holds the lower-cased names in each directory that are not part of this batch.
 */
export function planRenames(
  files: RenameInput[],
  existing: Map<string, Set<string>>,
  settings: Settings,
  templates?: Partial<Record<MediaKind, string>>,
): Map<string, string> {
  const parsed = {
    photo: parseTemplate(templates?.photo ?? settings.rename.templates.photo),
    video: parseTemplate(templates?.video ?? settings.rename.templates.video),
  };
  const { digits, start } = settings.rename.counter;
  const groups = new Map<string, RenameInput[]>();
  for (const f of files) {
    const base = renderParts(parsed[f.kind].parts, f.ctx, '') + normalizeExtension(f.name, settings);
    const key = `${f.dir}\u0000${base.toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }

  const taken = new Map<string, Set<string>>();
  const takenIn = (dir: string) => {
    let s = taken.get(dir);
    if (!s) taken.set(dir, (s = new Set(existing.get(dir) ?? [])));
    return s;
  };

  const out = new Map<string, string>();
  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const g = groups.get(key)!.sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name));
    const dir = g[0].dir;
    const used = takenIn(dir);
    const ext = (f: RenameInput) => normalizeExtension(f.name, settings);
    const plain = renderParts(parsed[g[0].kind].parts, g[0].ctx, '') + ext(g[0]);
    if (g.length === 1 && !used.has(plain.toLowerCase())) {
      used.add(plain.toLowerCase());
      out.set(g[0].id, plain);
      continue;
    }
    let n = start;
    for (const f of g) {
      let name: string;
      do {
        name = renderParts(parsed[f.kind].parts, f.ctx, pad(n++, digits)) + ext(f);
      } while (used.has(name.toLowerCase()));
      used.add(name.toLowerCase());
      out.set(f.id, name);
    }
  }
  return out;
}

/** True when `name` is something the template could have produced for this file (any counter). */
export function matchesTemplate(name: string, kind: MediaKind, ctx: RenderContext, settings: Settings): boolean {
  const { parts, errors } = parseTemplate(settings.rename.templates[kind]);
  if (errors.length) return true;
  const marker = '\u0001';
  const withMarker = renderParts(parts, ctx, marker);
  const esc = withMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const digits = settings.rename.counter.digits;
  const hasXX = parts.some((p) => 'tok' in p && p.tok === 'XX');
  const body = hasXX ? esc.replace(marker, `(?:\\d{${digits}})?`) : esc.replace(`_${marker}`, `(?:_\\d{${digits}})?`);
  const re = new RegExp(`^${body}$`);
  const extOk = name.slice(baseOf(name).length) === normalizeExtension(name, settings) || extOf(name) === '';
  return extOk && re.test(baseOf(name));
}

/** Example output for the Settings live preview. */
export function previewTemplate(template: string, kind: MediaKind, settings: Settings, counter = ''): string {
  const { parts, errors } = parseTemplate(template);
  if (errors.length) return '';
  const ctx: RenderContext = {
    local: { y: 2026, M: 10, d: 8, h: 9, m: 40, s: 4, ms: 120 },
    offset: formatOffset(180),
    typeLabel: settings.rename.typeLabels[kind],
    orig: kind === 'photo' ? 'IMG-20261008-WA0001' : 'VID-20261008-WA0001',
    make: 'INFINIX',
    model: 'X6833B',
    folder: 'Bikers',
  };
  return renderParts(parts, ctx, counter) + (kind === 'photo' ? '.jpg' : '.mp4');
}
