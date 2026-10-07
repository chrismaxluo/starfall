// 直播软件输出（需求 F-OU-01 ~ 06）
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';
import { OutputInputSchema, OutputPatchSchema, chatPath, giftsPath, overlayPath } from '../services/outputs.ts';
import type { OutputRow } from '../services/outputs.ts';

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const idOf = (req: FastifyRequest) => parseBody(IdParam, req.params).id;
const dto = (o: OutputRow) => ({ ...o, path: overlayPath(o), chatPath: chatPath(o), giftsPath: giftsPath(o) });

export function outputRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/outputs', async () => ({ outputs: ctx.outputs.list().map(dto) }));

  app.post('/api/outputs', async (req) => dto(ctx.outputs.create(parseBody(OutputInputSchema.partial().required({ name: true }), req.body))));

  app.put('/api/outputs/:id', async (req) => dto(ctx.outputs.update(idOf(req), parseBody(OutputPatchSchema, req.body))));

  app.delete('/api/outputs/:id', async (req) => {
    ctx.outputs.remove(idOf(req));
    return { ok: true };
  });

  app.post('/api/outputs/:id/reset-key', async (req) => dto(ctx.outputs.resetKey(idOf(req))));
}
