import type { PublicConfig } from '@io/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { APP_VERSION } from '../../version.js';
import { parse } from '../validate.js';

/** Settings, static config view, trash and automation rules. */
export function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/config', async (): Promise<PublicConfig> => ({
    version: APP_VERSION,
    mapTileUrl: ctx.config.map.tileUrl,
    mapAttribution: ctx.config.map.attribution,
    nominatimUrl: ctx.config.map.nominatimUrl,
    defaultTimezone: ctx.config.timezone.default,
    maxUploadMB: ctx.config.import.maxUploadMB,
    trashRetentionDays: ctx.settings.get().trash.retentionDays ?? ctx.config.trash.retentionDays,
    roots: ctx.roots.dirs,
  }));

  /** Static config with secrets masked, for the read-only view in Settings. */
  app.get('/api/config/static', async () => ({
    ...ctx.config,
    admin: { username: ctx.config.admin.username, passwordHash: '••••••' },
    session: { ...ctx.config.session, secret: '••••••' },
  }));

  app.get('/api/settings', async () => ctx.settings.get());
  app.put('/api/settings', async (req) => ctx.settings.set(req.body));

  app.get('/api/trash', async () => ctx.trash.list());
  const Ids = z.object({ ids: z.array(z.number().int()).optional(), all: z.boolean().optional() });
  app.post('/api/trash/restore', async (req) => {
    const { ids = [] } = parse(Ids, req.body);
    return ctx.jobs.exclusive(async () => {
      const restored = [];
      for (const id of ids) restored.push(await ctx.trash.restore(id));
      return { restored };
    });
  });
  app.post('/api/trash/purge', async (req) => {
    const body = parse(Ids, req.body);
    return ctx.jobs.exclusive(async () => {
      const ids = body.all ? ctx.trash.list().map((t) => t.id) : (body.ids ?? []);
      for (const id of ids) await ctx.trash.purge(id);
      return { purged: ids.length };
    });
  });

  app.get('/api/rules', async () => ctx.automation.list());
  app.post('/api/rules', async (req) => ctx.automation.save(req.body));
  app.put<{ Params: { id: string } }>('/api/rules/:id', async (req) => ctx.automation.save(req.body, req.params.id));
  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req) => {
    ctx.automation.remove(req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/rules/:id/run', async (req) => ctx.automation.run(req.params.id));
  app.post<{ Params: { id: string } }>('/api/rules/:id/plan', async (req) => {
    const p = await ctx.automation.dryRun(req.params.id);
    return { items: p.items, warnings: p.warnings, fileCount: p.fileCount };
  });
}
