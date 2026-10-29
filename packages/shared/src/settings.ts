import { z } from 'zod';

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
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
