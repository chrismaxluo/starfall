import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { APP_NAME } from '@starfall/shared';
import type { AppContext } from './context.ts';
import { HttpError, sendError } from './http.ts';
import { authRoutes, SESSION_COOKIE } from './routes/auth.ts';

export interface AppOptions {
  logger?: boolean;
}

/** 不需要登录的接口 */
const PUBLIC = new Set(['/api/health', '/api/auth/login']);

export async function buildApp(ctx: AppContext, opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return sendError(reply, error);
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode;
    if (status === 429) return sendError(reply, new HttpError(429, 'too_many_requests', '操作太频繁，请稍后再试'));
    if (status && status < 500) return sendError(reply, new HttpError(status, 'bad_request', err.message));
    app.log.error(err);
    return sendError(reply, new HttpError(500, 'internal', '服务出错了，请查看日志'));
  });

  // 修改类接口只接受 JSON（配合 SameSite=Strict 防止跨站请求伪造）；除登录和健康检查外都需要登录
  app.addHook('onRequest', async (req) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['content-type'] && !req.headers['content-type'].startsWith('application/json') && !req.headers['content-type'].startsWith('multipart/form-data')) {
      throw new HttpError(415, 'unsupported_media_type', '只接受 JSON 请求');
    }
    if (PUBLIC.has(url)) return;
    if (!ctx.auth.checkSession(req.cookies[SESSION_COOKIE])) throw new HttpError(401, 'unauthorized', '请先登录');
  });

  app.get('/api/health', async () => ({ ok: true, name: APP_NAME, time: Date.now() }));
  authRoutes(app, ctx);

  return app;
}
