// 送礼名单页：挑记录（按场次）、挂上 / 撤下 / 排顺序
import type { FastifyInstance } from 'fastify';
import type { GiftListItem } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';
import { PINS_MAX } from '../services/gift-pins.ts';
import { eventFromLog } from '../services/pipeline.ts';

/** 一场最多列出多少条 */
const RECORDS_MAX = 1000;

export function giftListRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 一条事件记录变成送礼名单的一条；不是礼物、上舰、醒目留言或者是免费礼物时为 null */
  const itemOf = (row: Parameters<typeof eventFromLog>[0]): GiftListItem | null => {
    const ev = eventFromLog(row);
    return ev ? ctx.pipeline.giftListItem(ev) : null;
  };
  const pinsChanged = () => {
    ctx.hub.setPins(ctx.giftPins.items());
    return { pins: ctx.giftPins.list() };
  };

  // 本直播间最近的场次（最新的在前）；current 是正在直播的那一场
  app.get('/api/gift-list/sessions', async () => {
    const room = ctx.room.get();
    return { current: ctx.live.status().sessionId, sessions: room ? ctx.log.sessionList(room.roomId) : [] };
  });

  // 某一场收到的礼物、上舰、醒目留言（最新的在前），带上事件编号（挂上用）
  app.get('/api/gift-list/records', async (req) => {
    const { session } = parseBody(z.object({ session: z.coerce.number().int().positive() }).passthrough(), req.query);
    const items: Array<GiftListItem & { eventId: number }> = [];
    for (const row of ctx.log.giftListEvents(session, RECORDS_MAX)) {
      const it = itemOf(row);
      if (it) items.push({ ...it, eventId: row.id });
    }
    return { items: items.reverse(), max: RECORDS_MAX };
  });

  app.get('/api/gift-list/pins', async () => ({ pins: ctx.giftPins.list(), max: PINS_MAX }));

  app.post('/api/gift-list/pins', async (req) => {
    const { eventId } = parseBody(z.object({ eventId: z.number().int().positive() }).strict(), req.body);
    const row = ctx.log.giftEvent(eventId);
    const item = row ? itemOf(row) : null;
    if (!item) throw new HttpError(404, 'not_found', '找不到这条送礼记录（可能已经过了保留期被删掉了）');
    ctx.giftPins.add(eventId, item);
    return pinsChanged();
  });

  app.delete('/api/gift-list/pins/:id', async (req) => {
    const { id } = parseBody(z.object({ id: z.coerce.number().int().positive() }), req.params);
    ctx.giftPins.remove(id);
    return pinsChanged();
  });

  app.put('/api/gift-list/pins/order', async (req) => {
    const { ids } = parseBody(z.object({ ids: z.array(z.number().int().positive()).max(PINS_MAX) }).strict(), req.body);
    ctx.giftPins.reorder(ids);
    return pinsChanged();
  });
}
