import type { MediaEntry, MediaMeta, VideoCodec } from './media.js';
import type { Settings } from './settings.js';

export const CODEC_LABEL: Record<VideoCodec, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', other: 'Other codec' };

/** Average bitrate (bps): ExifTool's AvgBitrate, else size over duration. */
export function bitrateOf(m: MediaMeta, size: number): number | undefined {
  if (m.bitrate) return m.bitrate;
  return m.duration ? (size * 8) / m.duration : undefined;
}

export type ConvertSkip = 'notVideo' | 'codec' | 'bitrate';

/** Why a file isn't worth converting under the current settings, or null when it is a candidate. */
export function convertSkipReason(e: Pick<MediaEntry, 'kind' | 'meta' | 'size'>, c: Settings['convert']): ConvertSkip | null {
  if (e.kind !== 'video') return 'notVideo';
  if (e.meta.videoCodec && c.skipCodecs.includes(e.meta.videoCodec)) return 'codec';
  const bps = bitrateOf(e.meta, e.size);
  if (bps !== undefined && bps < c.minBitrateMbps * 1e6) return 'bitrate';
  return null;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return n > 0 ? `${Math.max(1, Math.round(n / 1e3))} KB` : '0 B';
}

export const formatBitrate = (bps: number) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbps` : `${Math.round(bps / 1e3)} kbps`);

/** "H.264 · 19.1 Mbps · 2.90 GB" */
export function describeVideo(m: MediaMeta, size: number): string {
  const bps = bitrateOf(m, size);
  return [m.videoCodec ? CODEC_LABEL[m.videoCodec] : 'Unknown codec', bps !== undefined ? formatBitrate(bps) : null, formatBytes(size)]
    .filter(Boolean)
    .join(' · ');
}
