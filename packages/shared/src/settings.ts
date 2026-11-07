import { z } from 'zod';
import { CONVERT_PRESETS } from './api.js';
import { octalMode, posixId } from './folders.js';

export const ISSUE_CHECK_IDS = [
  'missingOriginalDate',
  'missingGps',
  'missingOffset',
  'missingCamera',
  'dateMismatchFile',
  'dateMismatchFilename',
  'nameOffTemplate',
] as const;
export type IssueCheckId = (typeof ISSUE_CHECK_IDS)[number];

export const DEFAULT_TEMPLATE = '{YYYY}{MM}{DD}_{HH}{mm}{ss}{XX}_{TYPE}';

const dateSource = z.enum(['original', 'create', 'filename', 'fileModify']);

// zod 4: `.prefault({})` parses the fallback so nested defaults apply; `.default({})` would not.
/** Dynamic settings, editable from the Settings page and stored in /app/data/app.db. */
export const SettingsSchema = z.object({
  dateSources: z.array(dateSource).min(1).default(['original', 'create', 'filename', 'fileModify']),
  rename: z
    .object({
      templates: z
        .object({ photo: z.string().default(DEFAULT_TEMPLATE), video: z.string().default(DEFAULT_TEMPLATE) })
        .prefault({}),
      typeLabels: z.object({ photo: z.string().default('PIC'), video: z.string().default('VID') }).prefault({}),
      counter: z
        .object({ digits: z.number().int().min(1).max(4).default(2), start: z.number().int().min(0).max(999).default(1) })
        .prefault({}),
    })
    .prefault({}),
  extensions: z
    .object({
      lowercase: z.boolean().default(true),
      map: z.record(z.string(), z.string()).default({ '.jpeg': '.jpg', '.jpe': '.jpg', '.m4v': '.mp4' }),
    })
    .prefault({}),
  issues: z
    .object({
      enabled: z.boolean().default(true),
      checks: z
        .partialRecord(z.enum(ISSUE_CHECK_IDS), z.boolean())
        .default(Object.fromEntries(ISSUE_CHECK_IDS.map((id) => [id, true])) as Record<IssueCheckId, boolean>),
      toleranceSeconds: z.number().int().min(0).default(60),
    })
    .prefault({}),
  trash: z.object({ retentionDays: z.number().int().min(0).nullable().default(null) }).prefault({}),
  convert: z
    .object({
      crf: z.number().int().min(0).max(51).default(24),
      preset: z.enum(CONVERT_PRESETS).default('medium'),
      /** Videos already in these codecs are skipped (re-encoding only loses quality). */
      skipCodecs: z.array(z.enum(['h264', 'hevc', 'av1', 'other'])).default(['hevc', 'av1']),
      /** Videos below this average bitrate are skipped; savings would be small. 0 = convert all. */
      minBitrateMbps: z.number().min(0).default(10),
      /** Keep the original when the result isn't at least this much smaller. */
      minSavingPct: z.number().int().min(0).max(95).default(20),
      /** JPEG quality for Convert HEIC to JPG. */
      jpegQuality: z.number().int().min(1).max(100).default(90),
    })
    .prefault({}),
  /**
   * Owner and mode given to every file and folder the app creates or changes (jobs, undo, uploads,
   * new folders, trash and restore). null leaves that part as the write left it.
   */
  ownership: z
    .object({
      enabled: z.boolean().default(false),
      uid: posixId.nullable().default(null),
      gid: posixId.nullable().default(null),
      fileMode: octalMode.nullable().default(null),
      dirMode: octalMode.nullable().default(null),
    })
    .prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
