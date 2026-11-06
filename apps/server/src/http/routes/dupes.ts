import { DupeScanRequestSchema } from '@io/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { parse } from '../validate.js';

export function dupeRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Start a duplicate/similar scan of a folder (read-only). Progress arrives as 'scan' events on /api/events. */
  app.post('/api/dupes/scan', async (req) => ctx.dupes.start(parse(DupeScanRequestSchema, req.body)));

  /** The latest scan with its groups; `threshold` regroups a finished near/similar scan without rehashing. */
  app.get('/api/dupes/scan', async (req) => {
    const q = parse(z.object({ threshold: z.coerce.number().optional() }), req.query);
    return (await ctx.dupes.result(q.threshold)) ?? null;
  });

  app.post('/api/dupes/cancel', async () => ctx.dupes.cancel());
}
