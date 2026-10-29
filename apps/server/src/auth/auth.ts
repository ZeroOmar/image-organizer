import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config/schema.js';
import type { DB } from '../db/db.js';

export const SESSION_COOKIE = 'io_session';
/** Every mutating /api request must carry this header (CSRF guard on top of SameSite=Strict). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'image-organizer';

const PUBLIC = new Set(['/api/auth/login', '/api/health']);

declare module 'fastify' {
  interface FastifyRequest {
    user?: string;
  }
}

function sameString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function registerAuth(app: FastifyInstance, db: DB, config: AppConfig) {
  const ttlMs = config.session.ttlHours * 3_600_000;

  const sessionUser = (req: FastifyRequest): string | null => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return null;
    const un = req.unsignCookie(raw);
    if (!un.valid || !un.value) return null;
    const row = db.prepare('SELECT username, expires_at FROM sessions WHERE id = ?').get(un.value) as
      | { username: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at < Date.now()) return null;
    return row.username;
  };

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      return reply.code(403).send({ error: 'Missing CSRF header' });
    }
    if (PUBLIC.has(url)) return;
    const user = sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in' });
    req.user = user;
  });

  const setCookie = (req: FastifyRequest, reply: FastifyReply, value: string, maxAgeSec: number) =>
    reply.setCookie(SESSION_COOKIE, value, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      // TLS ends at the reverse proxy; trustProxy makes req.protocol reflect X-Forwarded-Proto.
      secure: req.protocol === 'https',
      signed: true,
      maxAge: maxAgeSec,
    });

  const Login = z.object({ username: z.string().max(200), password: z.string().max(1000) });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = Login.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Username and password are required' });
      const okUser = sameString(body.data.username, config.admin.username);
      const okPass = await bcrypt.compare(body.data.password, config.admin.passwordHash);
      if (!okUser || !okPass) return reply.code(401).send({ error: 'Wrong username or password' });
      const id = randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      db.prepare('INSERT INTO sessions (id, username, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        id,
        config.admin.username,
        Date.now(),
        Date.now() + ttlMs,
      );
      setCookie(req, reply, id, ttlMs / 1000);
      return { username: config.admin.username };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const un = raw ? req.unsignCookie(raw) : null;
    if (un?.valid && un.value) db.prepare('DELETE FROM sessions WHERE id = ?').run(un.value);
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ username: req.user }));
}
