// 播放控制、测试、模拟（需求 F-PL-05 ~ 06、F-RU-05）
import type { FastifyInstance } from 'fastify';
import { PLAY_STATUS } from '@starfall/shared';
import type { Viewer } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';
import { assetDto } from '../services/assets.ts';
import { EffectPatchSchema } from '../services/effects.ts';
import type { TriggerEvent } from '../services/pipeline.ts';

const SimViewerSchema = z
  .object({
    uid: z.number().int().min(0).default(1),
    name: z.string().max(40).default('模拟观众'),
    guard: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
    isMod: z.boolean().default(false),
    /** 粉丝牌等级；own 为假表示戴的是别的主播的牌子 */
    medal: z.object({ level: z.number().int().min(1).max(60), own: z.boolean().default(true) }).nullable().default(null),
  })
  .strict();

/** 某个时区里某一天 0 点的时间戳 */
export function dayStart(day: string, timeZone: string): number {
  const utc = Date.parse(`${day}T00:00:00Z`);
  // 算出这个时区在那一刻相对 UTC 的偏移
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return utc - (asUtc - utc);
}

export function playbackRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/playback', async () => ({ paused: ctx.settings.get('paused'), queue: ctx.pipeline.snapshot(), overlays: ctx.hub.overlayList() }));

  app.post('/api/playback/pause', async () => {
    ctx.pipeline.pause();
    return { paused: true };
  });

  app.post('/api/playback/resume', async () => {
    ctx.pipeline.resume();
    return { paused: false };
  });

  app.post('/api/playback/clear', async () => ({ cleared: ctx.pipeline.clear() }));

  app.post('/api/playback/test', async (req) => {
    const { effectId } = parseBody(z.object({ effectId: z.number().int().positive() }).strict(), req.body);
    return ctx.pipeline.test(effectId);
  });

  // 预览：返回播放内容（后台用真实的特效页在本地播放），不入队、不上直播
  app.post('/api/preview', async (req) => {
    const b = parseBody(
      z.object({
        effectId: z.number().int().positive(),
        kind: z.enum(['enter', 'danmu', 'gift', 'guard']).default('enter'),
        viewer: z
          .object({ name: z.string().max(40), guard: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), isMod: z.boolean(), medalLevel: z.number().int().min(1).max(60).nullable() })
          .partial()
          .strict()
          .optional(),
        /** 还没保存的修改（素材设置里预览用） */
        draft: EffectPatchSchema.omit({ name: true }).optional(),
        /** 欢迎语变量（弹幕内容、礼物和数量、上舰月数）；不填用示例 */
        vars: z
          .object({ text: z.string().max(100), gift: z.string().max(40), count: z.number().int().min(1), valueGold: z.number().int().min(0), months: z.number().int().min(1).max(120), guardLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]) })
          .partial()
          .strict()
          .optional(),
      }).strict(),
      req.body,
    );
    const saved = ctx.effects.get(b.effectId);
    const d = b.draft ?? {};
    let sound = saved.sound;
    if (d.soundAssetId !== undefined) {
      const a = d.soundAssetId === null ? undefined : ctx.assets.get(d.soundAssetId);
      sound = a && a.kind === 'audio' ? assetDto(a) : null;
    }
    const effect = { ...saved, ...d, sound };
    const v = b.viewer ?? {};
    const medal = v.medalLevel === null ? { medal: undefined } : v.medalLevel ? { medal: { name: '星临', level: v.medalLevel, anchorUid: 0 } } : {};
    const { medalLevel: _m, ...rest } = v;
    return ctx.pipeline.preview(effect, { ...rest, ...medal }, b.kind, b.vars);
  });

  // 今天（按主播时区）的统计
  app.get('/api/stats/today', async () => {
    const day = ctx.pipeline.today();
    const since = dayStart(day, ctx.config.timeZone);
    return { day, since, ...ctx.log.statsSince(since, ctx.room.get()?.anchorUid ?? 0) };
  });

  // 模拟一次事件（进场 / 弹幕 / 礼物 / 上舰）：只判断，不入队、不记录
  app.post('/api/simulate', async (req) => {
    const b = parseBody(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('enter'), viewer: SimViewerSchema }).strict(),
        z.object({ kind: z.literal('danmu'), viewer: SimViewerSchema, text: z.string().min(1).max(100) }).strict(),
        z.object({
          kind: z.literal('gift'),
          viewer: SimViewerSchema,
          giftId: z.number().int().min(0).default(0),
          giftName: z.string().max(40).default('礼物'),
          /** 单价（金瓜子）；0 表示免费礼物 */
          unitPrice: z.number().int().min(0).max(100_000_000),
          count: z.number().int().min(1).max(100_000),
        }).strict(),
        z.object({ kind: z.literal('guard'), viewer: SimViewerSchema, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), op: z.enum(['open', 'renew']), months: z.number().int().min(1).max(120).default(1) }).strict(),
      ]),
      // 兼容旧的调用方式（没有 kind 时按进场处理）
      req.body && typeof req.body === 'object' && !('kind' in req.body) ? { ...req.body, kind: 'enter' } : req.body,
    );
    const v = b.viewer;
    const anchorUid = ctx.room.get()?.anchorUid ?? 0;
    const viewer: Viewer = {
      uid: v.uid,
      name: v.name,
      guard: b.kind === 'guard' ? b.level : v.guard,
      isMod: v.isMod,
      mystery: false,
      ...(v.medal ? { medal: { name: '粉丝牌', level: v.medal.level, anchorUid: v.medal.own ? anchorUid : -1 } } : {}),
    };
    const base = { id: 'sim', ts: Date.now(), viewer };
    const ev: TriggerEvent =
      b.kind === 'enter'
        ? { ...base, kind: 'enter', source: 'interact' }
        : b.kind === 'danmu'
          ? { ...base, kind: 'danmu', text: b.text }
          : b.kind === 'gift'
            ? { ...base, kind: 'gift', giftId: b.giftId, giftName: b.giftName, unitPrice: b.unitPrice, count: b.count, paid: b.unitPrice > 0 }
            : { ...base, kind: 'guard', level: b.level, op: b.op, months: b.months, source: 'toast' };
    const r = ctx.pipeline.simulate(ev);
    return { ...r, statusText: PLAY_STATUS[r.status] };
  });
}
