import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomStatsPatch } from '@starfall/bili';
import { BiliHttp } from '@starfall/bili';
import { openDb } from '../db/index.ts';
import { room } from '../db/schema.ts';
import type { LiveStatus } from './live.ts';
import { RoomInfoService } from './room-info.ts';
import type { RoomInfoDeps } from './room-info.ts';
import { RoomStore } from './room.ts';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const db = openDb(':memory:');
  db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '旧昵称' }).run();
  const roomStore = new RoomStore(db);
  const statsFns = new Set<(p: RoomStatsPatch) => void>();
  const statusFns = new Set<(s: LiveStatus) => void>();
  let live = false;
  const status = () => ({ live }) as LiveStatus;
  const liveFake = {
    onStats: (fn: (p: RoomStatsPatch) => void) => (statsFns.add(fn), () => statsFns.delete(fn)),
    onStatus: (fn: (s: LiveStatus) => void) => (statusFns.add(fn), () => statusFns.delete(fn)),
    status,
  };
  const calls: number[] = [];
  let fail = false;
  const deps: RoomInfoDeps = {
    getRoomInfo: async (_h, roomId) => {
      calls.push(roomId);
      if (fail) throw new Error('网络错误');
      return { roomId, anchorUid: 20000, title: `标题${roomId}`, liveStatus: live ? 1 : 0, liveTime: '', liveSince: null, isPortrait: true, parentAreaName: '娱乐', areaName: '视频唱见', cover: '', keyframe: live ? 'k.jpg' : '', followers: 100 };
    },
    getAnchorInfo: async (_h, uid) => ({ uid, name: '主播', face: 'f.jpg', followers: 120 }),
    now: () => 1,
  };
  const svc = new RoomInfoService({ room: roomStore, live: liveFake, http: () => new BiliHttp() }, deps);
  const got: unknown[] = [];
  svc.onChange((i) => got.push(i));
  return {
    svc, roomStore, calls, got,
    stats: (p: RoomStatsPatch) => statsFns.forEach((f) => f(p)),
    setLive: (v: boolean) => { live = v; statusFns.forEach((f) => f(status())); },
    setFail: (v: boolean) => (fail = v),
  };
}

describe('直播间信息', () => {
  it('标题、分区、主播、粉丝数；没有封面时用直播画面截图', async () => {
    const t = setup();
    await t.svc.start();
    expect(t.svc.get()).toMatchObject({ roomId: 30000, title: '标题30000', parentAreaName: '娱乐', areaName: '视频唱见', cover: '', anchor: { uid: 20000, name: '主播', face: 'f.jpg' }, followers: 120, watched: null });
    t.setLive(true);
    await vi.waitFor(() => expect(t.svc.get()?.cover).toBe('k.jpg'));
    t.svc.stop();
  });

  it('直播时的实时数字合并推送；下播后清空', async () => {
    const t = setup();
    await t.svc.start();
    t.got.length = 0;
    t.stats({ watched: 10 });
    t.stats({ watched: 12, rankCount: 3 });
    t.stats({ likes: 99, followers: 130, fansClub: 5 });
    expect(t.got).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(t.got).toHaveLength(1);
    expect(t.svc.get()).toMatchObject({ watched: 12, rankCount: 3, likes: 99, followers: 130, fansClub: 5 });
    t.stats({ title: '新标题' });
    vi.advanceTimersByTime(2000);
    expect(t.svc.get()?.title).toBe('新标题');
    t.setLive(true);
    t.setLive(false);
    expect(t.svc.get()).toMatchObject({ watched: null, rankCount: null, likes: null });
    t.svc.stop();
  });

  it('查询失败时保留上一次的结果；换直播间后重新查询', async () => {
    const t = setup();
    await t.svc.start();
    t.setFail(true);
    await t.svc.refresh();
    expect(t.svc.get()?.title).toBe('标题30000');
    t.setFail(false);
    t.roomStore.save({ roomId: 40000, shortId: 0, anchorUid: 20001, anchorName: '' });
    expect(t.got.at(-1)).toBeNull();
    await vi.waitFor(() => expect(t.svc.get()).toMatchObject({ roomId: 40000, title: '标题40000', anchor: { uid: 20001 } }));
    t.svc.stop();
  });
});
