import { kindOf, type FileRef } from '@io/shared';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { Roots } from '../fs/roots.js';
import type { Metadata } from '../metadata/exiftool.js';

const run = promisify(execFile);

/** Small semaphore so a big folder doesn't start hundreds of sharp/ffmpeg jobs at once. */
class Limit {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/**
 * JPEG thumbnails and previews, cached under /app/cache/thumbs by (path, size, mtime).
 * Photos: sharp (auto-rotated) → ffmpeg → embedded JPEG. Videos: one ffmpeg frame.
 * Originals are never modified; video preview streams the original file (no transcoding).
 */
export class Thumbs {
  private dir: string;
  private limit = new Limit(4);
  private inflight = new Map<string, Promise<string>>();

  constructor(
    appDir: string,
    private roots: Roots,
    private metadata: Metadata,
  ) {
    this.dir = path.join(appDir, 'cache', 'thumbs');
  }

  async get(ref: FileRef, size: number): Promise<string> {
    const { root, rel, abs } = this.roots.resolve(ref);
    const st = await fs.stat(abs);
    const key = createHash('sha1').update(`${root}\0${rel}\0${size}\0${st.mtimeMs}\0${st.size}`).digest('hex');
    const out = path.join(this.dir, key.slice(0, 2), `${key}.jpg`);
    try {
      await fs.access(out);
      return out;
    } catch {
      /* not cached */
    }
    let p = this.inflight.get(out);
    if (!p) {
      p = this.limit.run(() => this.render(abs, out, size)).finally(() => this.inflight.delete(out));
      this.inflight.set(out, p);
    }
    return p;
  }

  private async render(abs: string, out: string, size: number): Promise<string> {
    await fs.mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.${randomUUID()}.tmp`;
    try {
      if (kindOf(abs) === 'video') {
        await this.ffmpegFrame(abs, tmp, size, true);
      } else {
        try {
          await sharp(abs, { failOn: 'none' }).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(tmp);
        } catch {
          try {
            await this.ffmpegFrame(abs, tmp, size, false);
          } catch {
            const emb = `${tmp}.emb.jpg`;
            await this.metadata.extractEmbeddedJpeg(abs, emb);
            await sharp(emb).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(tmp);
            await fs.rm(emb, { force: true });
          }
        }
      }
      await fs.rename(tmp, out);
      return out;
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }

  private async ffmpegFrame(abs: string, out: string, size: number, seek: boolean): Promise<void> {
    const args = [
      '-v', 'error', '-y',
      ...(seek ? ['-ss', '0.5'] : []),
      '-i', abs,
      '-frames:v', '1',
      '-vf', `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease`,
      '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', out,
    ];
    await run('ffmpeg', args, { timeout: 60_000 });
    const st = await fs.stat(out).catch(() => null);
    if (!st?.size) throw new Error('ffmpeg produced no frame');
  }
}
