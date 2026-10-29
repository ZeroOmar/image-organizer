import { kindOf } from '@io/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { uniqueName, walkFiles } from '../../fs/ops.js';
import { joinRel } from '../../fs/roots.js';
import { HttpError } from '../errors.js';
import { parse } from '../validate.js';

export function importRoutes(app: FastifyInstance, ctx: AppContext) {
  /**
   * One file per request (the browser queues them for per-file progress). Streams into a hidden
   * temp file inside /import and renames it into place only when complete.
   */
  app.post('/api/import/upload', async (req) => {
    const q = parse(z.object({ rel: z.string().default(''), lastModified: z.coerce.number().optional() }), req.query);
    const dir = ctx.roots.resolve({ root: 'import', rel: q.rel });
    await fs.mkdir(dir.abs, { recursive: true });
    const part = await req.file();
    if (!part) throw new HttpError(400, 'No file in request');
    const original = path.basename(part.filename || 'upload');
    if (!kindOf(original) || original.startsWith('.')) {
      part.file.resume();
      throw new HttpError(415, `Unsupported file type: ${original}`);
    }
    const tmp = path.join(dir.abs, `.upload-${randomUUID()}.part`);
    try {
      await pipeline(part.file, createWriteStream(tmp, { flags: 'wx' }));
      if (part.file.truncated) throw new HttpError(413, `File is larger than ${ctx.config.import.maxUploadMB} MB`);
      const name = await uniqueName(dir.abs, original);
      await fs.rename(tmp, path.join(dir.abs, name));
      if (q.lastModified && Number.isFinite(q.lastModified)) {
        const t = new Date(q.lastModified);
        await fs.utimes(path.join(dir.abs, name), t, t).catch(() => undefined);
      }
      return { root: 'import', rel: joinRel(dir.rel, name) };
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
  });

  app.get('/api/import/count', async () => {
    const dir = ctx.roots.resolve({ root: 'import', rel: '' });
    return { count: (await walkFiles(dir.abs, '')).length };
  });
}
