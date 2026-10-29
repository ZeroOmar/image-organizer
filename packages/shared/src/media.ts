export type MediaKind = 'photo' | 'video';

/** Lower-case extensions (with dot) the app manages. Everything else is ignored in listings. */
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.jpe', '.png', '.webp', '.heic', '.heif'] as const;
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'] as const;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
};

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

export function baseOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function kindOf(name: string): MediaKind | null {
  const ext = extOf(name);
  if ((PHOTO_EXTENSIONS as readonly string[]).includes(ext)) return 'photo';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  return null;
}

export function mimeOf(name: string): string {
  return MIME[extOf(name)] ?? 'application/octet-stream';
}

/** Formats the browser can't render natively; previews come from a server-side JPEG. */
export function needsJpegPreview(name: string): boolean {
  const ext = extOf(name);
  return ext === '.heic' || ext === '.heif';
}

export type RootName = 'media' | 'import' | 'trash';

export interface FileRef {
  root: RootName;
  /** POSIX path relative to the root, no leading slash. '' is the root itself. */
  rel: string;
}

export interface GpsPoint {
  lat: number;
  lon: number;
  alt?: number | null;
}

/** Normalized metadata read from a file by ExifTool. Raw date strings are kept as ExifTool prints them. */
export interface MediaMeta {
  width?: number;
  height?: number;
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  fNumber?: number;
  exposureTime?: number;
  focalLength?: number;
  focalLength35?: number;
  orientation?: number;
  duration?: number;
  /** Photo: EXIF DateTimeOriginal, local wall time "YYYY:MM:DD HH:MM:SS". */
  dateTimeOriginal?: string;
  /** Photo: EXIF CreateDate (local wall time). */
  createDate?: string;
  modifyDate?: string;
  offsetTimeOriginal?: string;
  offsetTime?: string;
  subSecTimeOriginal?: string;
  /** Video: QuickTime CreateDate, stored in UTC by spec. */
  qtCreateDate?: string;
  /** Video: Keys:CreationDate (Apple), local time with offset. */
  qtCreationDate?: string;
  gps?: GpsPoint;
  rating?: number;
  keywords?: string[];
}

export interface MediaEntry extends FileRef {
  name: string;
  kind: MediaKind;
  size: number;
  mtimeMs: number;
  meta: MediaMeta;
  metaError?: string;
  /** IANA zone derived from GPS (server-side, offline lookup), when GPS is present. */
  gpsTz?: string | null;
}
