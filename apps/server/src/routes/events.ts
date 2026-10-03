// 事件记录与黑名单（需求 F-UI-04、F-PL-08）
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PLAY_STATUS } from '@starfall/shared';
import type { PlayStatus } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';
import { dayStart } from './playback.ts';

const STATUSES = Object.keys(PLAY_STATUS) as [PlayStatus, ...PlayStatus[]];

const EventQuery = z.object({
  kind: z.enum(['enter', 'danmu', 'gift', 'guard', 'sc']).optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(STATUSES)).optional()),
  q: z.string().max(40).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** 时间范围：today 今天（按主播时区）、live 本场（没开播时是上一场）、7d 最近 7 天 */
  range: z.enum(['today', 'live', '7d']).optional(),
});

const UidParam = z.object({ uid: z.coerce.number().int().positive() });
const uidOf = (req: FastifyRequest) => parseBody(UidParam, req.params).uid;

export function eventRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/events', async (req) => {
    const q = parseBody(EventQuery, req.query);
    const room = ctx.room.get();
    let from: number | undefined;
    let to: number | undefined;
    if (q.range === 'today') from = dayStart(ctx.pipeline.today(), ctx.config.timeZone);
    else if (q.range === '7d') from = Date.now() - 7 * 86400_000;
    else if (q.range === 'live') {
      const live = ctx.live.status();
      const last = room ? ctx.live.lastSession(room.roomId) : null;
      if (live.live && live.liveSince !== null) from = live.liveSince;
      else if (last) [from, to] = [last.startedAt, last.endedAt];
      else from = Date.now();
    }
    return ctx.log.query({ roomId: room?.roomId ?? 0, ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}), ...(q.q ? { q: q.q } : {}), ...(q.cursor ? { cursor: q.cursor } : {}), ...(q.limit ? { limit: q.limit } : {}), ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) });
  });

  app.get('/api/blacklist', async () => ({ blacklist: ctx.blacklist.list() }));

  app.post('/api/blacklist', async (req) => {
    const b = parseBody(z.object({ uid: z.number().int().positive(), name: z.string().max(40).optional(), note: z.string().max(100).optional() }).strict(), req.body);
    const name = b.name ?? (await ctx.viewers.lookup(b.uid).then((v) => v.name, () => ''));
    return ctx.blacklist.add({ ...b, name });
  });

  app.delete('/api/blacklist/:uid', async (req) => {
    ctx.blacklist.remove(uidOf(req));
    return { ok: true };
  });
}
