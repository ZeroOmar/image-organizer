import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { registerAuth } from '../auth/auth.js';
import type { AppContext } from '../context.js';
import { APP_VERSION } from '../version.js';
import { HttpError } from './errors.js';
import { adminRoutes } from './routes/admin.js';
import { browseRoutes } from './routes/browse.js';
import { importRoutes } from './routes/import.js';
import { jobRoutes } from './routes/jobs.js';

export async function buildApp(ctx: AppContext, opts: { webDist?: string; logger?: boolean } = {}): Promise<FastifyInstance> {
  // TLS ends at the reverse proxy: trust X-Forwarded-* for client IP (rate limit) and protocol (Secure cookie).
  // forceCloseConnections: close() must not wait for long-lived SSE (/api/events) or keep-alive sockets.
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 5 * 1024 * 1024, forceCloseConnections: true });

  await app.register(cookie, { secret: ctx.config.session.secret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: ctx.config.import.maxUploadMB * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: (err as Error).message || 'Internal error' });
  });

  registerAuth(app, ctx.db, ctx.config);
  app.get('/api/health', async () => ({ ok: true, version: APP_VERSION }));
  browseRoutes(app, ctx);
  jobRoutes(app, ctx);
  importRoutes(app, ctx);
  adminRoutes(app, ctx);

  const webDist = opts.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));
  }
  return app;
}
