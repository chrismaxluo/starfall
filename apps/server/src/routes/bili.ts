// B 站账号、直播间、连接状态（需求 F-BL-01 ~ 03、F-BL-10）
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BiliApiError } from '@starfall/bili';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';

const biliError = (e: unknown, what: string): never => {
  if (e instanceof BiliApiError) throw new HttpError(502, 'bili_error', `${what}失败：${e.message}（B 站错误码 ${e.code}）`);
  throw new HttpError(502, 'bili_unreachable', `${what}失败：连不上 B 站（${(e as Error).message}）`);
};

/** 总览用的状态：连接、直播、账号、暂停、队列、在线特效页 */
export function statusSnapshot(ctx: AppContext) {
  const q = ctx.pipeline.snapshot();
  return {
    live: ctx.live.status(),
    account: ctx.account.status(),
    room: ctx.room.get(),
    paused: ctx.settings.get('paused'),
    queue: { playing: q.playing !== null, size: q.items.length },
    overlays: ctx.hub.overlayCount(),
  };
}

export function biliRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/bili/account', async () => ctx.account.status());

  app.post('/api/bili/qrcode', async () => {
    try {
      return await ctx.account.startQrLogin();
    } catch (e) {
      return biliError(e, '申请二维码');
    }
  });

  app.get<{ Params: { key: string } }>('/api/bili/qrcode/:key', async (req) => {
    try {
      const state = await ctx.account.pollQrLogin(req.params.key);
      return { state, ...(state === 'success' ? { account: ctx.account.status() } : {}) };
    } catch (e) {
      return biliError(e, '查询扫码状态');
    }
  });

  app.delete('/api/bili/account', async () => ctx.account.logout());

  app.get('/api/room', async () => ({ room: ctx.room.get() }));

  app.put('/api/room', async (req) => {
    const { id } = parseBody(z.object({ id: z.number().int().positive().max(1e12) }), req.body);
    try {
      return { room: await ctx.room.set(ctx.account.anon, id) };
    } catch (e) {
      return biliError(e, '查询直播间');
    }
  });

  app.get('/api/status', async () => statusSnapshot(ctx));

  app.get('/api/settings', async () => ctx.settings.all());

  app.put('/api/settings', async (req) => {
    const b = parseBody(
      z.object({
        connectMode: z.enum(['live_only', 'always']).optional(),
        offlinePolicy: z.enum(['mute', 'play']).optional(),
        cooldownMode: z.enum(['minutes', 'oncePerLive']).optional(),
        queueMax: z.number().int().min(3).max(30).optional(),
        queueJump: z.boolean().optional(),
        blockAnchor: z.boolean().optional(),
        blockAccount: z.boolean().optional(),
        retentionDays: z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(180)]).optional(),
        giftComboEnabled: z.boolean().optional(),
        giftComboSec: z.number().int().min(1).max(15).optional(),
        autoBackup: z.boolean().optional(),
        onboarded: z.boolean().optional(),
      }).strict(),
      req.body,
    );
    for (const [k, v] of Object.entries(b)) ctx.settings.set(k as keyof typeof b, v as never);
    if (b.connectMode || b.offlinePolicy) await ctx.live.reconcile();
    return ctx.settings.all();
  });
}
