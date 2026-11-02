import type { ConvertPreset } from '@io/shared';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

let available: Promise<boolean> | null = null;

/** Whether this ffmpeg build has libx265 (checked once). */
export function hasX265(): Promise<boolean> {
  available ??= run('ffmpeg', ['-hide_banner', '-encoders'], { maxBuffer: 4 * 1024 * 1024 }).then(
    ({ stdout }) => /\blibx265\b/.test(stdout),
    () => false,
  );
  return available;
}

export interface EncodeOptions {
  crf: number;
  preset: ConvertPreset;
  format: 'mov' | 'mp4';
  /** Source duration in seconds, for progress. */
  duration?: number;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

/**
 * Re-encode the first video track to HEVC (libx265), copying every audio track as-is.
 * ffmpeg keeps the source pixel format (10-bit HDR stays 10-bit) and color tags, and bakes the
 * display rotation into the frames. Container tags are carried by -map_metadata; the caller still
 * copies the rest with ExifTool (ffmpeg drops UserData GPS and XMP). `out` is removed on failure.
 */
export async function encodeHevc(src: string, out: string, o: EncodeOptions): Promise<void> {
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-nostats', '-y',
    '-i', src,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:v', 'libx265', '-crf', String(o.crf), '-preset', o.preset, '-x265-params', 'log-level=error',
    // hvc1 (not hev1) so Apple devices and browsers play it.
    '-tag:v', 'hvc1',
    '-c:a', 'copy',
    '-map_metadata', '0', '-movflags', '+faststart+use_metadata_tags',
    '-progress', 'pipe:1',
    // Explicit muxer: the name is a temp name, and .m4v would pick the "ipod" muxer.
    '-f', o.format,
    out,
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      if (o.signal?.aborted) return reject(new Error('Cancelled'));
      const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let buf = '';
      p.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
      p.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_us=(\d+)/.exec(line);
          if (m && o.duration && o.onProgress) o.onProgress(Math.min(99, (Number(m[1]) / 1e6 / o.duration) * 100));
        }
      });
      const abort = () => p.kill('SIGKILL');
      o.signal?.addEventListener('abort', abort, { once: true });
      p.on('error', reject);
      p.on('close', (code) => {
        o.signal?.removeEventListener('abort', abort);
        if (o.signal?.aborted) reject(new Error('Cancelled'));
        else if (code === 0) resolve();
        else reject(new Error(`ffmpeg failed (${code}): ${stderr.trim().split('\n').pop() ?? ''}`));
      });
    });
  } catch (e) {
    await fs.rm(out, { force: true });
    throw e;
  }
  o.onProgress?.(100);
}
