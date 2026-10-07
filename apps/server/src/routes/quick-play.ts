// 素材快捷播放：按钮列表、点按钮播放
import type { FastifyInstance } from 'fastify';
import { QuickButtonsInputSchema } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { parseBody } from '../http.ts';

const IdParam = z.object({ id: z.coerce.number().int().positive() });

export function quickPlayRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/quickplay/buttons', async () => ({ buttons: ctx.quickPlay.list() }));

  app.put('/api/quickplay/buttons', async (req) => {
    const { buttons } = parseBody(z.object({ buttons: QuickButtonsInputSchema }).strict(), req.body);
    return { buttons: ctx.quickPlay.save(buttons) };
  });

  // 播放按钮对应的素材（电脑版的全局快捷键也调用这里）
  app.post('/api/quickplay/play/:id', async (req) => {
    const b = ctx.quickPlay.get(parseBody(IdParam, req.params).id);
    return ctx.pipeline.quick(b.effectId);
  });
}
