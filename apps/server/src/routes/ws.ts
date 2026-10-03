// WebSocket（方案设计 9.3）：/ws/overlay 给特效页，/ws/admin 给管理后台。
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { OVERLAY_CLOSE, OVERLAY_TIMING } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { SESSION_COOKIE } from './auth.ts';
import { statusSnapshot } from './bili.ts';
import { PLAY_ACK_MS } from '../services/hub.ts';

const PING_MS = 30_000;

const OverlayMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('report'), env: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])) }),
  z.object({ type: z.literal('started'), id: z.string().max(64) }),
  z.object({ type: z.literal('ended'), id: z.string().max(64) }),
  z.object({ type: z.literal('error'), id: z.string().max(64).optional(), message: z.string().max(500) }),
  z.object({ type: z.literal('alive') }),
]);

/** 本输出可能用到的文件：规则里引用的素材的画面和音效 */
export function preloadUrls(ctx: AppContext): string[] {
  const rules = ctx.enterRules.full();
  const ids = new Set<number>();
  for (const t of Object.values(rules.tiers)) if (t.enabled && t.effectId) ids.add(t.effectId);
  for (const b of rules.bands) if (b.enabled && b.effectId) ids.add(b.effectId);
  for (const x of rules.exclusives) if (x.enabled) ids.add(x.effectId);
  const urls = new Set<string>();
  for (const e of ctx.effects.list()) {
    if (!ids.has(e.id)) continue;
    if (e.asset) urls.add(e.asset.url);
    if (e.sound) urls.add(e.sound.url);
  }
  return [...urls];
}

/** 定时 ping，收不到 pong 就断开（直播软件里的页面可能卡死或网络断了但没有关闭事件） */
function keepAlive(socket: WebSocket, onDead: () => void): () => void {
  let alive = true;
  socket.on('pong', () => (alive = true));
  const t = setInterval(() => {
    if (!alive) {
      socket.terminate();
      onDead();
      return;
    }
    alive = false;
    socket.ping();
  }, PING_MS);
  return () => clearInterval(t);
}

/**
 * 特效页的应用层保活：
 * - 定时发 { type: 'ping' }，特效页据此判断连接是否还活着（浏览器里看不到协议层的 ping）；
 * - 特效页定时报平安，太久没报就认为页面卡死（协议层的 pong 由浏览器网络层自动回复，页面卡死时照样会回）。
 *   只对报过平安的页面生效：更新前打开、还没刷新的旧页面不会报平安。
 */
function overlayAlive(socket: WebSocket, onDead: () => void, onTick: () => void): { alive(): void; stop(): void } {
  let aliveAt: number | null = null;
  const tick = setInterval(onTick, 1000);
  const t = setInterval(() => {
    if (aliveAt !== null && Date.now() - aliveAt > OVERLAY_TIMING.aliveTimeoutMs) {
      socket.terminate();
      onDead();
      return;
    }
    socket.send(JSON.stringify({ type: 'ping' }));
  }, OVERLAY_TIMING.pingMs);
  return {
    alive: () => (aliveAt = Date.now()),
    stop: () => {
      clearInterval(t);
      clearInterval(tick);
    },
  };
}

export function wsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { output?: string; key?: string; view?: string } }>('/ws/overlay', { websocket: true }, (socket, req) => {
    const output = ctx.outputs.verify(Number(req.query.output), String(req.query.key ?? ''));
    if (!output) {
      socket.close(OVERLAY_CLOSE.badKey, 'bad key');
      return;
    }
    // 弹幕列表和特效页用同一个连接地址，多一个 view=chat
    // 浏览器查看页多一个 view=1：照样收特效，但不算在线
    const role = req.query.view === 'chat' ? 'chat' : 'fx';
    const view = role === 'fx' && req.query.view === '1';
    const what = role === 'chat' ? '弹幕列表' : view ? '特效页（浏览器查看）' : '特效页';
    const client = ctx.hub.addOverlay(socket, output, role === 'chat' ? [] : preloadUrls(ctx), Date.now(), role, view);
    const log = req.log.child({ output: output.id, ip: req.ip, ...(role === 'chat' ? { view: 'chat' } : view ? { view: 'browser' } : {}) });
    log.info(`${what}已连接`);
    // 记录断开原因，方便排查"特效页不显示"
    let reason: string | null = null;
    const stop = keepAlive(socket, () => {
      reason ??= '收不到回应（网络断开）';
      ctx.hub.removeOverlay(client);
    });
    const hb = overlayAlive(
      socket,
      () => {
        reason ??= '页面长时间没有报平安（可能卡死）';
        ctx.hub.removeOverlay(client);
      },
      () => {
        for (const label of ctx.hub.playTimeouts(client)) log.warn(`特效页没有播放：${label}（${PLAY_ACK_MS / 1000} 秒内没有回应）`);
      },
    );
    socket.on('message', (data) => {
      let msg;
      try {
        msg = OverlayMsg.parse(JSON.parse(String(data)));
      } catch {
        return;
      }
      if (msg.type === 'alive') hb.alive();
      else if (msg.type === 'started') {
        const r = ctx.hub.playStarted(client, msg.id);
        if (r) log.info(`特效页已播放：${r.label}（${r.ms} ms）`);
      }
      else if (msg.type === 'report') ctx.hub.report(client, { env: msg.env });
      else if (msg.type === 'error') {
        ctx.hub.report(client, { lastError: msg.message });
        log.warn({ id: msg.id }, `${what}报错：${msg.message}`);
      }
    });
    socket.on('close', (code) => {
      stop();
      hb.stop();
      ctx.hub.removeOverlay(client);
      const minutes = Math.round((Date.now() - client.since) / 6000) / 10;
      const msg = `${what}已断开：${reason ?? `页面关闭连接（${code}）`}，本次连接 ${minutes} 分钟`;
      if (reason) log.warn(msg);
      else log.info(msg);
    });
  });

  app.get('/ws/admin', { websocket: true }, (socket, req) => {
    // 只接受同源页面（Cookie 已经是 SameSite=Strict，这里再加一道）
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      socket.close(4003, 'bad origin');
      return;
    }
    if (!ctx.auth.checkSession(req.cookies[SESSION_COOKIE])) {
      socket.close(4401, 'unauthorized');
      return;
    }
    ctx.hub.addAdmin(socket);
    socket.send(JSON.stringify({ type: 'hello', status: statusSnapshot(ctx), queue: ctx.pipeline.snapshot(), overlays: ctx.hub.overlayList(), roomInfo: ctx.roomInfo.get(), build: ctx.adminBuild.current(), chat: ctx.hub.recentChat() }));
    const stop = keepAlive(socket, () => ctx.hub.removeAdmin(socket));
    socket.on('close', () => {
      stop();
      ctx.hub.removeAdmin(socket);
    });
  });
}
