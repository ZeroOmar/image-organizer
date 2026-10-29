import { dateCandidates, parseOffset, type ResolvedDate } from './dates.js';
import type { MediaEntry } from './media.js';
import type { IssueCheckId, Settings } from './settings.js';
import { matchesTemplate, renderContext } from './template.js';

export type IssueCategory = 'missing' | 'mismatch' | 'name';

export interface Issue {
  id: IssueCheckId;
  category: IssueCategory;
  message: string;
}

interface CheckContext {
  entry: MediaEntry;
  resolved: ResolvedDate | null;
  settings: Settings;
  folder: string;
}

interface IssueCheck {
  id: IssueCheckId;
  label: string;
  category: IssueCategory;
  /** Return a message when the file has the issue, otherwise null. */
  check: (c: CheckContext) => string | null;
}

/**
 * Registry of issue checks. To add one: add its id to ISSUE_CHECK_IDS in settings.ts,
 * then add an entry here. The Settings page and the Filter panel pick it up automatically.
 */
export const ISSUE_CHECKS: IssueCheck[] = [
  {
    id: 'missingOriginalDate',
    label: 'Missing capture date',
    category: 'missing',
    check: ({ entry }) =>
      (entry.kind === 'photo' ? !entry.meta.dateTimeOriginal : !entry.meta.qtCreateDate && !entry.meta.qtCreationDate)
        ? entry.kind === 'photo'
          ? 'No DateTimeOriginal'
          : 'No QuickTime CreateDate'
        : null,
  },
  {
    id: 'missingGps',
    label: 'Missing GPS',
    category: 'missing',
    check: ({ entry }) => (entry.meta.gps ? null : 'No GPS position'),
  },
  {
    id: 'missingOffset',
    label: 'Missing timezone offset',
    category: 'missing',
    check: ({ entry }) =>
      entry.kind === 'photo' && entry.meta.dateTimeOriginal && parseOffset(entry.meta.offsetTimeOriginal) === null
        ? 'No OffsetTimeOriginal'
        : null,
  },
  {
    id: 'missingCamera',
    label: 'Missing camera make/model',
    category: 'missing',
    check: ({ entry }) => (!entry.meta.make && !entry.meta.model ? 'No camera make or model' : null),
  },
  {
    id: 'dateMismatchFile',
    label: 'Capture date ≠ file date',
    category: 'mismatch',
    check: ({ entry, resolved, settings }) => {
      if (!resolved || resolved.source === 'fileModify') return null;
      const diff = Math.abs(resolved.utcMs - entry.mtimeMs) / 1000;
      return diff > settings.issues.toleranceSeconds ? `File modified date differs by ${humanDuration(diff)}` : null;
    },
  },
  {
    id: 'dateMismatchFilename',
    label: 'Capture date ≠ date in name',
    category: 'mismatch',
    check: ({ entry, resolved, settings }) => {
      const f = dateCandidates(entry).filename;
      if (!resolved || !f || f.type !== 'wall' || resolved.source === 'filename') return null;
      const r = resolved.local;
      if (f.dateOnly) {
        return f.wall.y === r.y && f.wall.M === r.M && f.wall.d === r.d ? null : 'Date in file name is a different day';
      }
      const diff =
        Math.abs(
          Date.UTC(f.wall.y, f.wall.M - 1, f.wall.d, f.wall.h, f.wall.m, f.wall.s) - Date.UTC(r.y, r.M - 1, r.d, r.h, r.m, r.s),
        ) / 1000;
      return diff > settings.issues.toleranceSeconds ? `Date in file name differs by ${humanDuration(diff)}` : null;
    },
  },
  {
    id: 'nameOffTemplate',
    label: 'Name doesn’t match template',
    category: 'name',
    check: ({ entry, resolved, settings, folder }) => {
      if (!resolved) return null;
      const ctx = renderContext({ ...entry, folder, make: entry.meta.make, model: entry.meta.model }, resolved, settings);
      return matchesTemplate(entry.name, entry.kind, ctx, settings) ? null : 'File name doesn’t follow the rename template';
    },
  },
];

export function computeIssues(c: CheckContext): Issue[] {
  if (!c.settings.issues.enabled) return [];
  const out: Issue[] = [];
  for (const chk of ISSUE_CHECKS) {
    if (c.settings.issues.checks[chk.id] === false) continue;
    const msg = chk.check(c);
    if (msg) out.push({ id: chk.id, category: chk.category, message: msg });
  }
  return out;
}

export function humanDuration(sec: number): string {
  if (sec < 120) return `${Math.round(sec)} s`;
  if (sec < 7200) return `${Math.round(sec / 60)} min`;
  if (sec < 172800) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} days`;
}
