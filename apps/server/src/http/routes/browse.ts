import { mimeOf, needsJpegPreview, type FileRef, type FolderListing } from '@io/shared';
import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { listDir, treeChildren, walkFiles } from '../../fs/ops.js';
import { joinRel, nameOfRel } from '../../fs/roots.js';
import { HttpError } from '../errors.js';
import { RefQuery, parse } from '../validate.js';

export function browseRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/tree', async (req) => {
    const q = parse(RefQuery, req.query);
    const dir = ctx.roots.resolve(q);
    return treeChildren(dir.abs, dir.rel);
  });

  app.get('/api/folder', async (req): Promise<FolderListing> => {
    const q = parse(RefQuery.extend({ recursive: z.enum(['0', '1']).default('0') }), req.query);
    const dir = ctx.roots.resolve(q);
    const listing = await listDir(dir.abs);
    const rels = q.recursive === '1' ? await walkFiles(dir.abs, dir.rel) : listing.files.map((f) => joinRel(dir.rel, f.name));
    const entries = await ctx.indexer.getEntries(rels.map((rel) => ({ root: dir.root, rel })));
    return {
      root: dir.root,
      rel: dir.rel,
      dirs: listing.dirs.map((name) => ({ name, rel: joinRel(dir.rel, name) })),
      entries: entries.map((e) => ctx.indexer.enrich(e)),
    };
  });

  app.get('/api/entry', async (req) => {
    const q = parse(RefQuery, req.query);
    return ctx.indexer.enrich(await ctx.indexer.getEntry(q));
  });

  app.get('/api/metadata', async (req) => {
    const q = parse(RefQuery, req.query);
    return ctx.metadata.readGrouped(ctx.roots.resolve(q).abs);
  });

  app.post('/api/folders', async (req) => {
    const body = parse(RefQuery.extend({ name: z.string().min(1).max(200) }), req.body);
    if (body.root === 'trash') throw new HttpError(400, 'Cannot create folders in the trash');
    if (/[/\\]|^\.+$|^\./.test(body.name)) throw new HttpError(400, 'Invalid folder name');
    const target = ctx.roots.resolve({ root: body.root, rel: joinRel(body.rel, body.name) });
    await fs.mkdir(target.abs, { recursive: false }).catch((e: NodeJS.ErrnoException) => {
      throw new HttpError(e.code === 'EEXIST' ? 409 : 500, e.code === 'EEXIST' ? 'Folder already exists' : e.message);
    });
    return { root: target.root, rel: target.rel };
  });

  app.get('/api/thumb', async (req, reply) => {
    const q = parse(RefQuery.extend({ size: z.coerce.number().int().min(64).max(2048).default(320) }), req.query);
    const file = await ctx.thumbs.get(q as FileRef, q.size).catch((e) => {
      throw new HttpError(422, `No thumbnail: ${(e as Error).message}`);
    });
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.type('image/jpeg');
    return reply.send(createReadStream(file));
  });

  /** Original bytes with HTTP Range support (video seeking). HEIC/HEIF get a JPEG preview instead. */
  app.get('/api/file', async (req, reply) => {
    const q = parse(RefQuery.extend({ download: z.enum(['0', '1']).default('0') }), req.query);
    const file = ctx.roots.resolve(q);
    if (q.download === '0' && needsJpegPreview(file.rel)) {
      const jpeg = await ctx.thumbs.get(q as FileRef, 2048);
      reply.type('image/jpeg').header('Cache-Control', 'private, max-age=86400');
      return reply.send(createReadStream(jpeg));
    }
    const st = await fs.stat(file.abs).catch(() => {
      throw new HttpError(404, 'File not found');
    });
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('Last-Modified', st.mtime.toUTCString());
    reply.type(mimeOf(file.rel));
    if (q.download === '1') reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nameOfRel(file.rel))}`);
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) {
        reply.header('Content-Range', `bytes */${st.size}`);
        return reply.code(416).send();
      }
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${st.size}`);
      reply.header('Content-Length', end - start + 1);
      return reply.send(createReadStream(file.abs, { start, end }));
    }
    reply.header('Content-Length', st.size);
    return reply.send(createReadStream(file.abs));
  });
}
