// 播放控制、测试、模拟（需求 F-PL-05 ~ 06、F-RU-05）
import type { FastifyInstance } from 'fastify';
import { HONOR_LEVEL_MAX, MEDAL_LEVEL_MAX, PLAY_STATUS } from '@starfall/shared';
import type { Viewer } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';
import { assetDto } from '../services/assets.ts';
import { EffectPatchSchema, playDuration } from '../services/effects.ts';
import type { TriggerEvent, Vars } from '../services/pipeline.ts';

const SimViewerSchema = z
  .object({
    uid: z.number().int().min(0).default(1),
    name: z.string().max(40).default('模拟观众'),
    guard: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
    isMod: z.boolean().default(false),
    /** 粉丝牌等级；own 为假表示戴的是别的主播的牌子 */
    medal: z.object({ level: z.number().int().min(1).max(MEDAL_LEVEL_MAX), own: z.boolean().default(true) }).nullable().default(null),
    /** 荣耀等级（0 没有） */
    honor: z.number().int().min(0).max(HONOR_LEVEL_MAX).default(0),
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

  app.post('/api/playback/skip', async () => ({ skipped: ctx.pipeline.skip() }));

  app.delete('/api/playback/queue/:id', async (req) => {
    const { id } = parseBody(z.object({ id: z.string().min(1).max(64) }), req.params);
    if (!ctx.pipeline.remove(id)) throw new HttpError(404, 'not_found', '这一项已经播放或不在队列里了');
    return { removed: true };
  });

  /** 预览、发到直播测试共用：特效编号 + 还没保存的修改 + 示例观众 + 欢迎语变量 */
  const PreviewBody = z.object({
    effectId: z.number().int().positive(),
    kind: z.enum(['enter', 'danmu', 'gift', 'guard']).default('enter'),
    viewer: z
      .object({ name: z.string().max(40), guard: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), isMod: z.boolean(), medalLevel: z.number().int().min(1).max(MEDAL_LEVEL_MAX).nullable(), honor: z.number().int().min(0).max(HONOR_LEVEL_MAX) })
      .partial()
      .strict()
      .optional(),
    /** 还没保存的修改（素材设置里预览用） */
    draft: EffectPatchSchema.omit({ name: true }).optional(),
    /** 欢迎语变量（弹幕内容、礼物和数量、上舰月数）；不填用示例 */
    vars: z
      .object({ text: z.string().max(100), gift: z.string().max(40), giftId: z.number().int().positive(), count: z.number().int().min(1), valueGold: z.number().int().min(0), months: z.number().int().min(1).max(120), guardLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]), op: z.enum(['open', 'renew']) })
      .partial()
      .strict()
      .optional(),
  }).strict();
  /** 把还没保存的修改套到已保存的特效上，示例观众换成播放用的样子 */
  const previewInput = (b: z.infer<typeof PreviewBody>) => {
    const saved = ctx.effects.get(b.effectId);
    const d = b.draft ?? {};
    let sound = saved.sound;
    if (d.soundAssetId !== undefined) {
      const a = d.soundAssetId === null ? undefined : ctx.assets.get(d.soundAssetId);
      sound = a && a.kind === 'audio' ? assetDto(a) : null;
    }
    const effect = { ...saved, ...d, sound };
    if (d.durationMs !== undefined || d.durationCustom !== undefined) effect.durationMs = playDuration(saved.asset?.durationMs, effect.durationCustom, effect.durationMs);
    const v = b.viewer ?? {};
    const medal = v.medalLevel === null ? { medal: undefined } : v.medalLevel ? { medal: { name: '星临', level: v.medalLevel, anchorUid: 0 } } : {};
    const { medalLevel: _m, ...rest } = v;
    return { effect, viewer: { ...rest, ...medal } };
  };
  /** 礼物图：按礼物编号（没给时按名字）查礼物面板；查不到就不放图，不能拿示例里小花花的图顶替 */
  const previewVars = (v: z.infer<typeof PreviewBody>['vars']): Vars | undefined => {
    if (!v) return undefined;
    const { giftId, ...rest } = v;
    if (rest.gift === undefined) return rest;
    const img = (giftId ? ctx.gifts.iconFor(giftId) : undefined) ?? ctx.gifts.iconByName(rest.gift);
    return img ? { ...rest, giftImg: img } : rest;
  };

  app.post('/api/playback/test', async (req) => {
    const b = parseBody(PreviewBody, req.body);
    // 只给了特效编号：和以前一样按已保存的样子、示例观众进场
    if (!b.draft && !b.viewer && !b.vars && b.kind === 'enter') return ctx.pipeline.test(b.effectId);
    const { effect, viewer } = previewInput(b);
    return ctx.pipeline.test(effect, viewer, b.kind, previewVars(b.vars));
  });

  // 预览：返回播放内容（后台用真实的特效页在本地播放），不入队、不上直播
  app.post('/api/preview', async (req) => {
    const b = parseBody(PreviewBody, req.body);
    const { effect, viewer } = previewInput(b);
    return ctx.pipeline.preview(effect, viewer, b.kind, previewVars(b.vars));
  });

  // 今天（按主播时区）的统计
  // 总览的统计：scope=live 本场（没开播时是上一场），scope=today 今天；只算当前直播间
  /** 数据范围：scope=live 本场（没开播时是上一场），scope=today 今天；from 为 null 表示没有这段时间（从来没开播过） */
  const range = (query: unknown) => {
    const { scope } = parseBody(z.object({ scope: z.enum(['live', 'today']).default('today') }).passthrough(), query);
    const room = ctx.room.get();
    const live = ctx.live.status();
    const last = room ? ctx.live.lastSession(room.roomId) : null;
    let from: number | null = null;
    let to: number | null = null;
    if (scope === 'today') from = dayStart(ctx.pipeline.today(), ctx.config.timeZone);
    else if (live.live && live.liveSince !== null) from = live.liveSince;
    else if (last) [from, to] = [last.startedAt, last.endedAt];
    return { scope, room, live, last, from, to };
  };

  app.get('/api/stats', async (req) => {
    const { scope, room, live, last, from, to } = range(req.query);
    const empty = { enterUnique: 0, guardUnique: 0, played: 0, guardPlayed: 0, composition: { gov: 0, adm: 0, cap: 0, mod: 0, fan: 0, nor: 0 }, honor: { l1: 0, l21: 0, l41: 0, l61: 0, none: 0 } };
    const stats = room && from !== null ? ctx.log.stats(room.roomId, from, to, room.anchorUid) : empty;
    return { scope, roomId: room?.roomId ?? null, from, to, live: scope === 'live' && live.live, lastSession: last ? { startedAt: last.startedAt, endedAt: last.endedAt } : null, ...stats };
  });

  // 总览右侧面板：礼物榜（按付费礼物总价值）
  app.get('/api/stats/gifts', async (req) => {
    const { scope, room, from, to } = range(req.query);
    const r = room && from !== null ? ctx.log.giftRank(room.roomId, from, to) : { people: 0, gold: 0, rows: [] };
    return { scope, from, to, ...r };
  });

  // 总览右侧面板：大航海（这段时间来了谁；舰队名单来自 B 站，读不到时只给来了的人）
  app.get('/api/stats/fleet', async (req) => {
    const { scope, room, from, to } = range(req.query);
    const came = room && from !== null ? ctx.log.guardVisits(room.roomId, from, to) : [];
    let fleet: { total: number; members: Array<{ uid: number; name: string; face: string; guard: number; isMod: boolean }>; updatedAt: number } | null = null;
    let fleetError: string | null = null;
    if (room) {
      try {
        const f = await ctx.audience.fleet();
        fleet = { total: f.total, members: f.members.map((m) => ({ uid: m.uid, name: m.name, face: m.face, guard: m.guard, isMod: m.isMod })), updatedAt: f.updatedAt };
      } catch (e) {
        fleetError = (e as Error).message;
      }
    }
    return { scope, from, to, came, fleet, fleetError };
  });

  // 总览右侧面板：在线观众（B 站高能榜）
  app.get('/api/online', async () => ctx.audience.online());

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
      ...(v.honor ? { honor: v.honor } : {}),
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
