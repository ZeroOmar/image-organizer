import { JobRequestSchema, type DupeScan, type JobInfo } from '@io/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { JobEngine } from '../../jobs/engine.js';
import { parse } from '../validate.js';

export function jobRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Dry run: what would happen, file by file. Nothing is changed. */
  app.post('/api/jobs/plan', async (req) => JobEngine.toResult(await ctx.jobs.plan(parse(JobRequestSchema, req.body))));

  app.post('/api/jobs', async (req) => ctx.jobs.submit(parse(JobRequestSchema, req.body)));

  app.get('/api/jobs', async () => ctx.jobs.list());

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => ctx.jobs.get(req.params.id));

  app.post<{ Params: { id: string } }>('/api/jobs/:id/undo', async (req) => ctx.jobs.undo(req.params.id));

  /** Stop a queued or running job (kills a running ffmpeg encode). Ops already done stay undoable. */
  app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req) => ctx.jobs.cancel(req.params.id));

  /** Server-sent events: every job update (progress, status) and duplicate-scan progress. */
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    const send = (job: JobInfo) => reply.raw.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
    const sendScan = (scan: DupeScan) => reply.raw.write(`event: scan\ndata: ${JSON.stringify(scan)}\n\n`);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    ctx.jobs.on('job', send);
    ctx.dupes.on('scan', sendScan);
    req.raw.on('close', () => {
      clearInterval(ping);
      ctx.jobs.off('job', send);
      ctx.dupes.off('scan', sendScan);
    });
  });
}
