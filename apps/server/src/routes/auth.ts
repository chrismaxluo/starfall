import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';
import { AuthError } from '../services/auth.ts';

export const SESSION_COOKIE = 'sf_session';

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password } = parseBody(z.object({ password: z.string().min(1).max(200) }), req.body);
    if (!ctx.auth.verify(password)) throw new HttpError(401, 'wrong_password', '密码不正确');
    const { token, maxAgeSec } = ctx.auth.issueSession();
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', maxAge: maxAgeSec, secure: req.protocol === 'https' });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    ctx.auth.revokeSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async () => ({ ok: true, desktop: ctx.config.desktop }));

  app.put('/api/auth/password', async (req, reply) => {
    const b = parseBody(z.object({ current: z.string(), next: z.string().min(8, '新密码至少 8 位').max(200) }), req.body);
    try {
      ctx.auth.changePassword(b.current, b.next);
    } catch (e) {
      if (e instanceof AuthError) throw new HttpError(400, 'password_change_failed', e.message);
      throw e;
    }
    const { token, maxAgeSec } = ctx.auth.issueSession();
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', maxAge: maxAgeSec, secure: req.protocol === 'https' });
    return { ok: true };
  });
}
