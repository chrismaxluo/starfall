import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { APP_NAME } from '@starfall/shared';
import type { AppContext } from './context.ts';
import { HttpError, sendError } from './http.ts';
import { authRoutes, SESSION_COOKIE } from './routes/auth.ts';
import { biliRoutes } from './routes/bili.ts';
import { libraryRoutes } from './routes/library.ts';
import { outputRoutes } from './routes/outputs.ts';
import { ruleRoutes } from './routes/rules.ts';

export interface AppOptions {
  logger?: boolean;
}

/** 不需要登录的接口 */
const PUBLIC = new Set(['/api/health', '/api/auth/login']);

export async function buildApp(ctx: AppContext, opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: ctx.assets.maxBytes, files: 1, fields: 10, parts: 11 } });
  // 素材文件：按内容哈希命名，内容不会变，可以长期缓存；支持断点续传（Range）
  await app.register(fastifyStatic, { root: ctx.assets.dir, prefix: '/files/', decorateReply: false, index: false, list: false, dotfiles: 'deny', maxAge: '365d', immutable: true });

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
  biliRoutes(app, ctx);
  libraryRoutes(app, ctx);
  ruleRoutes(app, ctx);
  outputRoutes(app, ctx);

  return app;
}
