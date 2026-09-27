import { describe, expect, it, vi } from 'vitest';
import type { BiliHttp, GiftConfig } from '@starfall/bili';
import { GiftCatalog } from './gifts.ts';
import type { RoomStore } from './room.ts';

const g = (id: number, icon: string): GiftConfig => ({ id, name: `礼物${id}`, price: 100, paid: true, icon });
const room = { get: () => ({ roomId: 30000 }) } as unknown as RoomStore;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('礼物图', () => {
  it('先查本直播间礼物面板，查不到再查全站礼物列表', async () => {
    const fetchAll = vi.fn(async () => [g(1, 'all-1'), g(2, 'all-2')]);
    const c = new GiftCatalog(room, () => ({}) as BiliHttp, async () => [g(1, 'room-1')], fetchAll);
    c.start();
    await flush();
    expect(c.iconFor(1)).toBe('room-1');
    expect(c.iconFor(2)).toBe('all-2');
    expect(c.iconFor(3)).toBeUndefined();
    expect(fetchAll).toHaveBeenCalledTimes(1);
  });

  it('全站列表读取失败时不会每次都重试', async () => {
    const fetchAll = vi.fn(async (): Promise<GiftConfig[]> => { throw new Error('x'); });
    const c = new GiftCatalog(room, () => ({}) as BiliHttp, async () => [], fetchAll);
    c.start();
    await flush();
    c.iconFor(5);
    c.iconFor(6);
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(1);
  });

  it('没调用 start 时不访问网络', () => {
    const fetchAll = vi.fn(async () => []);
    const c = new GiftCatalog(room, () => ({}) as BiliHttp, async () => [], fetchAll);
    expect(c.iconFor(1)).toBeUndefined();
    expect(fetchAll).not.toHaveBeenCalled();
  });
});
