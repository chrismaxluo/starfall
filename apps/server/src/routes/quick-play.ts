// 素材快捷播放：按钮列表、点按钮播放
import type { FastifyInstance } from 'fastify';
import { QUICK_GLOBAL_RE, QuickButtonsInputSchema } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';

const IdParam = z.object({ id: z.coerce.number().int().positive() });

export function quickPlayRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/quickplay/buttons', async () => ({ buttons: ctx.quickPlay.list() }));

  app.put('/api/quickplay/buttons', async (req) => {
    const { buttons } = parseBody(z.object({ buttons: QuickButtonsInputSchema }).strict(), req.body);
    return { buttons: ctx.quickPlay.save(buttons) };
  });

  // 播放按钮对应的素材
  app.post('/api/quickplay/play/:id', async (req) => {
    const b = ctx.quickPlay.get(parseBody(IdParam, req.params).id);
    return ctx.pipeline.quick(b.effectId);
  });

  // 桌面版的全局快捷键：按快捷键找按钮播放（保存按钮后按钮编号会变，快捷键不会）
  app.post('/api/quickplay/play-global', async (req) => {
    const { hotkey } = parseBody(z.object({ hotkey: z.string().regex(QUICK_GLOBAL_RE) }).strict(), req.body);
    const b = ctx.quickPlay.list().find((x) => x.globalHotkey === hotkey);
    if (!b) throw new HttpError(404, 'not_found', `没有按钮用全局快捷键 ${hotkey}`);
    return ctx.pipeline.quick(b.effectId);
  });
}
