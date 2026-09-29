// 弹幕 / 礼物 / 上舰规则、礼物面板（需求 F-DM、F-GF、F-GD）
import type { DanmuRule } from '@starfall/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';
import { DanmuInputSchema, DanmuOrderSchema, DanmuPatchSchema, GiftRulesInputSchema, GuardRulesInputSchema } from '../services/event-rules.ts';

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const idOf = (req: FastifyRequest) => parseBody(IdParam, req.params).id;

export function eventRuleRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 弹幕规则带上指定观众的昵称头像（后台显示用） */
  const dto = (r: DanmuRule) => ({
    ...r,
    people: r.who.uids.map((uid) => {
      const v = ctx.viewers.cached(uid);
      return { uid, name: v?.name || null, face: v?.face || null, guard: ctx.viewers.guardIn(uid) };
    }),
  });
  /** 新加的指定观众：先查一次昵称头像（查不到也能加） */
  const lookupNew = async (who: DanmuRule['who'] | undefined) => {
    for (const uid of who?.uids ?? []) if (!ctx.viewers.cached(uid)) await ctx.viewers.lookup(uid).catch(() => null);
  };
  app.get('/api/rules/danmu', async () => ({ rules: ctx.danmuRules.list().map(dto) }));
  app.post('/api/rules/danmu', async (req) => {
    const b = parseBody(DanmuInputSchema, req.body);
    await lookupNew(b.who);
    return dto(ctx.danmuRules.create(b));
  });
  // 注意：/order 要在 /:id 之前注册（Fastify 按静态路径优先，这里只是为了读起来清楚）
  app.put('/api/rules/danmu/order', async (req) => ({ rules: ctx.danmuRules.reorder(parseBody(DanmuOrderSchema, req.body).ids).map(dto) }));
  app.put('/api/rules/danmu/:id', async (req) => {
    const id = idOf(req);
    const b = parseBody(DanmuPatchSchema, req.body);
    await lookupNew(b.who);
    return dto(ctx.danmuRules.update(id, b));
  });
  app.delete('/api/rules/danmu/:id', async (req) => {
    ctx.danmuRules.remove(idOf(req));
    return { ok: true };
  });

  app.get('/api/rules/gift', async () => ctx.giftRules.get());
  app.put('/api/rules/gift', async (req) => ctx.giftRules.set(parseBody(GiftRulesInputSchema, req.body)));
  app.get<{ Querystring: { refresh?: string } }>('/api/gifts', async (req) => ({ gifts: await ctx.gifts.list(req.query.refresh === '1') }));

  app.get('/api/rules/guard', async () => ctx.guardRules.get());
  app.put('/api/rules/guard', async (req) => ctx.guardRules.set(parseBody(GuardRulesInputSchema, req.body)));
}
