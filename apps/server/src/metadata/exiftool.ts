import { parseExifDate, type MediaKind, type MediaMeta } from '@io/shared';
import { ExifTool, type WriteTags } from 'exiftool-vendored';

export type TagValue = string | number | string[] | null;
export type TagMap = Record<string, TagValue>;

/** "Group:Tag" or "Tag"; letters, digits, dash and underscore only. */
export const TAG_NAME = /^(?:[A-Za-z][\w-]*:)?[A-Za-z][\w-]*$/;

/**
 * The only place that talks to ExifTool. One long-lived pool of `-stay_open` processes.
 * Writes always pass -overwrite_original (undo comes from SQLite snapshots, not _original files)
 * and -P (keep the file's modified date; "Sync file dates" sets it explicitly).
 */
export class Metadata {
  readonly et = new ExifTool({ maxProcs: 4, taskTimeoutMillis: 120_000, ignoreZeroZeroLatLon: true });

  async readMeta(abs: string, kind: MediaKind): Promise<MediaMeta> {
    const t = (await this.et.readRaw(abs, { readArgs: ['-n'] })) as Record<string, unknown>;
    const str = (k: string) => (typeof t[k] === 'string' && (t[k] as string).trim() ? (t[k] as string).trim() : undefined);
    const num = (k: string) => (typeof t[k] === 'number' && Number.isFinite(t[k]) ? (t[k] as number) : undefined);
    const date = (k: string) => {
      const v = str(k);
      return v && parseExifDate(v) ? v : undefined;
    };
    const meta: MediaMeta = {
      width: num('ImageWidth'),
      height: num('ImageHeight'),
      make: str('Make'),
      model: str('Model'),
      lens: str('LensModel'),
      iso: num('ISO'),
      fNumber: num('FNumber'),
      exposureTime: num('ExposureTime'),
      focalLength: num('FocalLength'),
      focalLength35: num('FocalLengthIn35mmFormat'),
      orientation: num('Orientation'),
      duration: num('Duration'),
      rating: num('Rating'),
    };
    const kw = t.Subject ?? t.Keywords;
    if (kw !== undefined) meta.keywords = (Array.isArray(kw) ? kw : [kw]).map(String);
    if (kind === 'photo') {
      meta.dateTimeOriginal = date('DateTimeOriginal');
      meta.createDate = date('CreateDate');
      meta.modifyDate = date('ModifyDate');
      meta.offsetTimeOriginal = str('OffsetTimeOriginal');
      meta.offsetTime = str('OffsetTime');
      meta.subSecTimeOriginal = t.SubSecTimeOriginal !== undefined ? String(t.SubSecTimeOriginal) : undefined;
    } else {
      meta.qtCreateDate = date('CreateDate');
      meta.qtCreationDate = date('CreationDate');
    }
    const lat = num('GPSLatitude');
    const lon = num('GPSLongitude');
    if (lat !== undefined && lon !== undefined && !(lat === 0 && lon === 0)) {
      meta.gps = { lat, lon, alt: num('GPSAltitude') ?? null };
    }
    for (const k of Object.keys(meta) as (keyof MediaMeta)[]) if (meta[k] === undefined) delete meta[k];
    return meta;
  }

  /** Every tag, grouped by family-1 group, human-readable values (Metadata panel). */
  async readGrouped(abs: string): Promise<Record<string, Record<string, unknown>>> {
    const t = (await this.et.readRaw(abs, { readArgs: ['-G1', '-a', '-s'] })) as Record<string, unknown>;
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(t)) {
      if (key === 'SourceFile' || key === 'errors' || key === 'warnings') continue;
      const i = key.indexOf(':');
      const group = i > 0 ? key.slice(0, i) : 'Other';
      const tag = i > 0 ? key.slice(i + 1) : key;
      if (typeof value === 'string' && value.startsWith('(Binary data')) continue;
      (out[group] ??= {})[tag] = value;
    }
    return out;
  }

  /**
   * Current values of the given tags (missing → null), for undo. Printed values, not -n:
   * ExifTool writes them back losslessly enough (GPS to ~0.3 m) and they avoid -n quirks.
   */
  async snapshot(abs: string, tags: string[]): Promise<TagMap> {
    if (!tags.length) return {};
    const t = (await this.et.readRaw(abs, { readArgs: ['-G1', ...tags.map((n) => `-${n}`)] })) as Record<string, unknown>;
    const out: TagMap = {};
    for (const name of tags) {
      const short = name.slice(name.indexOf(':') + 1);
      // Prefer the exact group the caller named; fall back to any group carrying that tag.
      const hit =
        Object.entries(t).find(([k]) => k.toLowerCase() === name.toLowerCase()) ??
        Object.entries(t).find(([k]) => k.slice(k.indexOf(':') + 1).toLowerCase() === short.toLowerCase());
      const v = hit?.[1];
      out[name] = v === undefined ? null : Array.isArray(v) ? v.map(String) : typeof v === 'number' ? v : String(v);
    }
    return out;
  }

  async write(abs: string, tags: TagMap, opts: { numeric?: boolean } = {}): Promise<void> {
    for (const k of Object.keys(tags)) if (!TAG_NAME.test(k)) throw new Error(`Invalid tag name: ${k}`);
    const writeArgs = ['-overwrite_original', '-P', ...(opts.numeric ? ['-n'] : [])];
    const res = await this.et.write(abs, tags as WriteTags, { writeArgs });
    // ExifTool reports "unchanged" (not an error) for tags it can't write, e.g. Composite:*.
    // Clearing an already-empty tag is also "unchanged", which is fine, so only fail when a value was set.
    if (res.updated + res.created === 0 && Object.values(tags).some((v) => v !== null)) {
      throw new Error(res.warnings?.join('; ') || 'Nothing was written — the tag may be read-only');
    }
  }

  async copyFrom(source: string, target: string, tags: string[]): Promise<void> {
    for (const k of tags) if (!TAG_NAME.test(k)) throw new Error(`Invalid tag name: ${k}`);
    await this.et.write(target, {}, { writeArgs: ['-overwrite_original', '-P', '-tagsFromFile', source, ...tags.map((t) => `-${t}`)] });
  }

  /** Largest embedded JPEG (PreviewImage, then ThumbnailImage). Throws when there is none. */
  async extractEmbeddedJpeg(abs: string, out: string): Promise<void> {
    try {
      await this.et.extractPreview(abs, out);
    } catch {
      await this.et.extractThumbnail(abs, out);
    }
  }

  async close(): Promise<void> {
    await this.et.end();
  }
}
