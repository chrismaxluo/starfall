import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import { APP_NAME } from '@starfall/shared';
import type { AppContext } from './context.ts';
import { HttpError, sendError } from './http.ts';
import { authRoutes, SESSION_COOKIE } from './routes/auth.ts';
import { backupRoutes } from './routes/backup.ts';
import { biliRoutes } from './routes/bili.ts';
import { eventRuleRoutes } from './routes/event-rules.ts';
import { eventRoutes } from './routes/events.ts';
import { libraryRoutes } from './routes/library.ts';
import { outputRoutes } from './routes/outputs.ts';
import { playbackRoutes } from './routes/playback.ts';
import { ruleRoutes } from './routes/rules.ts';
import { wsRoutes } from './routes/ws.ts';

export interface AppOptions {
  logger?: boolean;
}

/** 把地址里的密钥换成 *** */
export const redactUrl = (url: string) => url.replace(/([?&]key=)[^&]*/g, '$1***');

/** 不需要登录的接口 */
const PUBLIC = new Set(['/api/health', '/api/auth/login']);
/** 管理后台根目录下可以直接访问的文件类型 */
const TOP_TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', ico: 'image/x-icon', png: 'image/png', webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8' };

/** 请求里的 Host 是不是本机地址（端口不限） */
function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function sameHost(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function buildApp(ctx: AppContext, opts: AppOptions = {}) {
  const app = Fastify({
    trustProxy: ctx.config.trustProxy,
    // 日志里不记录特效页密钥（地址里的 key 参数）
    logger: opts.logger ? { serializers: { req: (req) => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }) } } : false,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: ctx.assets.maxBytes, files: 1, fields: 10, parts: 11 } });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
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

  // 电脑版后台没有密码，再加两道：只认本机地址（防止别的网站用自己的域名指向 127.0.0.1 冒充本机），
  // 接口和后台连接只接受同源页面（防止浏览器里打开的其他网站偷偷调用本机的星临）
  if (ctx.config.desktop) {
    app.addHook('onRequest', async (req) => {
      if (!isLocalHost(req.headers.host)) throw new HttpError(403, 'forbidden', '只能用本机地址访问');
      const p = req.url.toLowerCase();
      if (!p.startsWith('/api') && !p.startsWith('/%') && !p.startsWith('/ws/')) return;
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((origin && !sameHost(origin, req.headers.host)) || (site && site !== 'same-origin' && site !== 'none')) throw new HttpError(403, 'forbidden', '不接受其他网站的请求');
    });
  }

  // 修改类接口只接受 JSON（配合 SameSite=Strict 防止跨站请求伪造）；除登录和健康检查外都需要登录。
  // 判断用路由匹配到的路径模板：Fastify 匹配前会解码 %xx，原始地址 /%61pi/... 也会匹配到 /api/... 的路由；
  // 解码后的地址兜底，没有匹配到路由的 /api/... 同样要求登录
  app.addHook('onRequest', async (req) => {
    const route = req.routeOptions.url ?? '';
    let path: string;
    try {
      path = decodeURIComponent(req.url.split('?')[0]!);
    } catch {
      throw new HttpError(400, 'bad_request', '地址格式不对');
    }
    if (!route.startsWith('/api/') && !path.toLowerCase().startsWith('/api/')) return;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['content-type'] && !req.headers['content-type'].startsWith('application/json') && !req.headers['content-type'].startsWith('multipart/form-data')) {
      throw new HttpError(415, 'unsupported_media_type', '只接受 JSON 请求');
    }
    if (PUBLIC.has(route)) return;
    if (!ctx.auth.checkSession(req.cookies[SESSION_COOKIE])) throw new HttpError(401, 'unauthorized', '请先登录');
  });

  // 规则、素材、设置、输出改动成功后通知所有打开的管理后台重新读取（多台设备同时打开时，不会拿着旧数据把别人的修改覆盖掉）
  const CHANGED: Array<[string, string]> = [['/api/rules', 'rules'], ['/api/effects', 'library'], ['/api/assets', 'library'], ['/api/sounds', 'library'], ['/api/settings', 'settings'], ['/api/blacklist', 'settings'], ['/api/outputs', 'outputs'], ['/api/room', 'settings'], ['/api/backup/import', 'all']];
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || reply.statusCode >= 400) return;
    const route = req.routeOptions.url ?? '';
    const hit = CHANGED.find(([prefix]) => route.startsWith(prefix));
    if (hit) ctx.hub.toAdmins({ type: 'changed', what: hit[1] });
  });

  // 特效页（构建好的静态文件）：带哈希的资源长期缓存，入口页每次都检查更新
  if (fs.existsSync(ctx.config.overlayDist)) {
    await app.register(fastifyStatic, {
      root: ctx.config.overlayDist,
      prefix: '/overlay/',
      decorateReply: false,
      cacheControl: false,
      setHeaders: (reply, file) => reply.header('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
    app.get('/overlay', async (req, reply) => reply.redirect(`/overlay/${req.url.slice('/overlay'.length)}`));
  }

  // 管理后台（构建好的静态文件，页面内用 # 路由，只需要提供 / 和资源文件）。
  // 每次请求都从磁盘读，重新构建后台后不用重启服务（不打断直播画面上的特效）
  if (fs.existsSync(ctx.config.adminDist)) {
    const dist = ctx.config.adminDist;
    await app.register(fastifyStatic, {
      root: path.join(dist, 'assets'),
      prefix: '/assets/',
      decorateReply: false,
      cacheControl: false,
      setHeaders: (reply) => reply.header('Cache-Control', 'public, max-age=31536000, immutable'),
    });
    // 入口页和根目录下的图标：不缓存
    const sendTop = async (reply: FastifyReply, name: string) => {
      const ext = path.extname(name).slice(1);
      const file = path.join(dist, name);
      if (!TOP_TYPES[ext] || !fs.existsSync(file)) throw new HttpError(404, 'not_found', '没有这个文件');
      return reply.header('Cache-Control', 'no-cache').type(TOP_TYPES[ext]).send(await fs.promises.readFile(file));
    };
    app.get('/', (_req, reply) => sendTop(reply, 'index.html'));
    app.get<{ Params: { file: string } }>('/:file', (req, reply) => {
      if (!/^[\w.-]+$/.test(req.params.file) || req.params.file.startsWith('.')) throw new HttpError(404, 'not_found', '没有这个文件');
      return sendTop(reply, req.params.file);
    });
  }

  app.get('/api/health', async () => ({ ok: true, name: APP_NAME, time: Date.now() }));
  authRoutes(app, ctx);
  biliRoutes(app, ctx);
  libraryRoutes(app, ctx);
  ruleRoutes(app, ctx);
  eventRuleRoutes(app, ctx);
  outputRoutes(app, ctx);
  playbackRoutes(app, ctx);
  eventRoutes(app, ctx);
  backupRoutes(app, ctx);
  await app.register(async (scope) => wsRoutes(scope, ctx));
  app.addHook('onClose', async () => ctx.hub.closeAll());

  return app;
}
