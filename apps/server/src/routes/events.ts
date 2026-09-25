// 事件记录与黑名单（需求 F-UI-04、F-PL-08）
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PLAY_STATUS } from '@starfall/shared';
import type { PlayStatus } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';

const STATUSES = Object.keys(PLAY_STATUS) as [PlayStatus, ...PlayStatus[]];

const EventQuery = z.object({
  kind: z.enum(['enter', 'danmu', 'gift', 'guard']).optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(STATUSES)).optional()),
  q: z.string().max(40).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const UidParam = z.object({ uid: z.coerce.number().int().positive() });
const uidOf = (req: FastifyRequest) => parseBody(UidParam, req.params).uid;

export function eventRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/events', async (req) => {
    const q = parseBody(EventQuery, req.query);
    return ctx.log.query({ ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}), ...(q.q ? { q: q.q } : {}), ...(q.cursor ? { cursor: q.cursor } : {}), ...(q.limit ? { limit: q.limit } : {}) });
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
