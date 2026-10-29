import { z } from 'zod';
import type { ResolvedDate } from './dates.js';
import type { Issue } from './issues.js';
import type { FileRef, MediaEntry } from './media.js';

export const FileRefSchema = z.object({
  root: z.enum(['media', 'import', 'trash']),
  rel: z.string(),
});

/** Tag groups offered by "Copy metadata". Dates and GPS are converted per file type; the rest copy as-is. */
export const COPY_GROUPS = {
  dates: { label: 'Dates & timezone', tags: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal'] },
  gps: { label: 'GPS position', tags: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude'] },
  camera: { label: 'Camera make & model', tags: ['Make', 'Model', 'Software'] },
  lens: { label: 'Lens', tags: ['LensMake', 'LensModel', 'FocalLength', 'FocalLengthIn35mmFormat', 'MaxApertureValue'] },
  exposure: {
    label: 'Exposure',
    tags: ['ExposureTime', 'FNumber', 'ISO', 'ExposureProgram', 'ExposureMode', 'MeteringMode', 'Flash', 'WhiteBalance'],
  },
  descriptive: {
    label: 'Title, description & credits',
    tags: ['XMP:Title', 'XMP:Description', 'ImageDescription', 'Artist', 'XMP:Creator', 'Copyright', 'XMP:Rights'],
  },
  keywords: { label: 'Keywords', tags: ['XMP:Subject', 'IPTC:Keywords'] },
  rating: { label: 'Rating', tags: ['XMP:Rating'] },
} as const;
export type CopyGroup = keyof typeof COPY_GROUPS;

const tagValue = z.union([z.string(), z.number(), z.array(z.string()), z.null()]);

export const StepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('applyDates') }),
  z.object({ type: z.literal('shiftDates'), seconds: z.number().int() }),
  z.object({ type: z.literal('setDate'), local: z.string(), tz: z.string() }),
  z.object({ type: z.literal('setTimezone'), tz: z.string(), keep: z.enum(['wall', 'instant']) }),
  z.object({
    type: z.literal('rename'),
    templates: z.object({ photo: z.string().optional(), video: z.string().optional() }).optional(),
  }),
  z.object({ type: z.literal('syncFileDates') }),
  z.object({
    type: z.literal('setGps'),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    alt: z.number().nullable().optional(),
  }),
  z.object({ type: z.literal('clearGps') }),
  z.object({
    type: z.literal('copyMetadata'),
    source: FileRefSchema,
    groups: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  }),
  z.object({ type: z.literal('editTags'), tags: z.record(z.string(), tagValue) }),
  z.object({ type: z.literal('move'), dest: FileRefSchema }),
  z.object({ type: z.literal('moveByDate'), pattern: z.string().min(1) }),
  z.object({ type: z.literal('trash') }),
]);
export type Step = z.infer<typeof StepSchema>;
export type StepType = Step['type'];

export const STEP_INFO: Record<StepType, { label: string; description: string; automation: boolean }> = {
  applyDates: { label: 'Write resolved date', description: 'Write the resolved capture date and UTC offset into the file metadata', automation: true },
  shiftDates: { label: 'Shift time', description: 'Move capture dates forward or back', automation: true },
  setDate: { label: 'Set date', description: 'Set an exact capture date and timezone', automation: false },
  setTimezone: { label: 'Set timezone', description: 'Assign a timezone, keeping the wall time or the instant', automation: true },
  rename: { label: 'Rename by template', description: 'Rename using the photo/video templates', automation: true },
  syncFileDates: { label: 'Sync file dates', description: 'Set file modified date to the capture date', automation: true },
  setGps: { label: 'Set GPS', description: 'Write a GPS position', automation: true },
  clearGps: { label: 'Clear GPS', description: 'Remove GPS tags', automation: true },
  copyMetadata: { label: 'Copy metadata', description: 'Copy selected tags from one file', automation: false },
  editTags: { label: 'Edit tags', description: 'Write tag values', automation: false },
  move: { label: 'Move', description: 'Move files to a folder', automation: true },
  moveByDate: { label: 'Move into dated folders', description: 'Move into /media folders like {YYYY}/{MM}', automation: true },
  trash: { label: 'Trash', description: 'Move files to the trash', automation: false },
};

export const SelectionSchema = z.union([
  z.object({ files: z.array(FileRefSchema).min(1) }),
  z.object({ folder: FileRefSchema, recursive: z.boolean().default(false) }),
]);
export type Selection = z.infer<typeof SelectionSchema>;

export const JobRequestSchema = z.object({
  title: z.string().optional(),
  selection: SelectionSchema,
  steps: z.array(StepSchema).min(1),
});
export type JobRequest = z.infer<typeof JobRequestSchema>;

export interface PlanItem {
  file: FileRef;
  step: number;
  action: string;
  before?: string;
  after?: string;
  error?: string;
}

export interface PlanResult {
  items: PlanItem[];
  warnings: string[];
  fileCount: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'undone';

export interface JobInfo {
  id: string;
  title: string;
  status: JobStatus;
  total: number;
  done: number;
  errors: { file?: string; message: string }[];
  createdAt: number;
  finishedAt: number | null;
  undoable: boolean;
  ruleId?: string | null;
}

export interface EnrichedEntry extends MediaEntry {
  resolved: ResolvedDate | null;
  issues: Issue[];
}

export interface FolderListing {
  root: FileRef['root'];
  rel: string;
  dirs: { name: string; rel: string }[];
  entries: EnrichedEntry[];
}

export interface TreeNode {
  name: string;
  rel: string;
  hasChildren: boolean;
}

export const RuleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  target: z.object({ folder: FileRefSchema, recursive: z.boolean().default(false) }),
  steps: z.array(StepSchema).min(1),
  schedule: z.string().nullable().default(null),
  watch: z.boolean().default(false),
});
export type Rule = z.infer<typeof RuleSchema> & { id: string; lastRunAt?: number | null; lastJobId?: string | null };

export interface TrashItem {
  id: number;
  originRoot: 'media' | 'import';
  originalRel: string;
  trashRel: string;
  size: number;
  deletedAt: number;
}

export interface PublicConfig {
  version: string;
  mapTileUrl: string;
  mapAttribution: string;
  nominatimUrl: string;
  defaultTimezone: string;
  maxUploadMB: number;
  trashRetentionDays: number;
  roots: Record<'media' | 'import' | 'trash', string>;
}
