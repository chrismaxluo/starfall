// 播放控制、测试、模拟（需求 F-PL-05 ~ 06、F-RU-05）
import type { FastifyInstance } from 'fastify';
import { PLAY_STATUS } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';

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
