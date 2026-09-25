// 进场规则与专属用户（需求 F-EN-01 ~ 09）
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';
import { EnterBaseSchema, ExclusiveInputSchema, ExclusivePatchSchema } from '../services/rules.ts';

const UidParam = z.object({ uid: z.coerce.number().int().positive() });
const uidOf = (req: FastifyRequest) => parseBody(UidParam, req.params).uid;

export function ruleRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/rules/enter', async () => ctx.enterRules.base());

  app.put('/api/rules/enter', async (req) => ctx.enterRules.setBase(parseBody(EnterBaseSchema, req.body)));

  app.get('/api/rules/exclusive', async () => ({ exclusives: ctx.enterRules.exclusives() }));

  app.post('/api/rules/exclusive', async (req) => {
    const x = parseBody(ExclusiveInputSchema, req.body);
    // 顺便查一下昵称头像，列表里好认；查不到不影响添加
    await ctx.viewers.lookup(x.uid).catch(() => null);
    return ctx.enterRules.addExclusive(x);
  });

  app.put('/api/rules/exclusive/:uid', async (req) => ctx.enterRules.updateExclusive(uidOf(req), parseBody(ExclusivePatchSchema, req.body)));

  app.delete('/api/rules/exclusive/:uid', async (req) => {
    ctx.enterRules.removeExclusive(uidOf(req));
    return { ok: true };
  });

  app.get('/api/viewers/:uid', async (req) => ctx.viewers.lookup(uidOf(req)));
}
