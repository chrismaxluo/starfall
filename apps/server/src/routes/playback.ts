// 播放控制、测试、模拟（需求 F-PL-05 ~ 06、F-RU-05）
import type { FastifyInstance } from 'fastify';
import { PLAY_STATUS } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';
import { assetDto } from '../services/assets.ts';
import { EffectPatchSchema } from '../services/effects.ts';

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
    return ctx.pipeline.preview(effect, { ...rest, ...medal }, b.kind);
  });

  // 今天（按主播时区）的统计
  app.get('/api/stats/today', async () => {
    const day = ctx.pipeline.today();
    const since = dayStart(day, ctx.config.timeZone);
    return { day, since, ...ctx.log.statsSince(since, ctx.room.get()?.anchorUid ?? 0) };
  });

  app.post('/api/simulate', async (req) => {
    const b = parseBody(z.object({ kind: z.literal('enter').default('enter'), viewer: SimViewerSchema }).strict(), req.body);
    const v = b.viewer;
    const anchorUid = ctx.room.get()?.anchorUid ?? 0;
    const r = ctx.pipeline.simulate({
      uid: v.uid,
      name: v.name,
      guard: v.guard,
      isMod: v.isMod,
      mystery: false,
      ...(v.medal ? { medal: { name: '粉丝牌', level: v.medal.level, anchorUid: v.medal.own ? anchorUid : -1 } } : {}),
    });
    return { ...r, statusText: PLAY_STATUS[r.status] };
  });
}
