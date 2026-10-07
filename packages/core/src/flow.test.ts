import { describe, expect, it } from 'vitest';
import { Cooldowns, OncePerLive } from './cooldown.ts';
import { decide } from './decide.ts';
import type { DecideInput } from './decide.ts';
import { EnterMerger } from './merge.ts';
import type { EnterEvent } from '@starfall/shared';
import { PlayQueue } from './queue.ts';
import type { QueueItem } from './queue.ts';

describe('进场合并（F-EN-10）', () => {
  const ev = (uid: number, source: EnterEvent['source'], p: Partial<EnterEvent['viewer']> = {}): EnterEvent => ({
    kind: 'enter', id: `${uid}-${source}`, ts: 0, source, viewer: { uid, name: source === 'interact' ? '完整昵称' : '特效昵称', guard: 0, isMod: false, mystery: false, ...p },
  });

  it('普通进场（只有 INTERACT_WORD_V2）立即输出', () => {
    const m = new EnterMerger();
    expect(m.push(ev(1, 'interact'), 0)).toHaveLength(1);
  });

  it('ENTRY_EFFECT 先到时等待，INTERACT_WORD_V2 到达后合并输出：粉丝牌来自后者，大航海取较高', () => {
    const m = new EnterMerger();
    expect(m.push(ev(1, 'entry_effect', { guard: 3 }), 0)).toEqual([]);
    const out = m.push(ev(1, 'interact', { medal: { name: '牌', level: 25, anchorUid: 9 } }), 1300);
    expect(out).toHaveLength(1);
    expect(out[0]!.viewer).toMatchObject({ name: '完整昵称', guard: 3, medal: { level: 25 } });
    expect(m.flush(5000)).toEqual([]);
  });

  it('合并时荣耀等级取有的那个（只有高级进场消息里带着时也不丢）', () => {
    const m = new EnterMerger();
    m.push(ev(1, 'entry_effect', { honor: 37 }), 0);
    expect(m.push(ev(1, 'interact'), 1300)[0]!.viewer.honor).toBe(37);
    m.push(ev(2, 'entry_effect'), 0);
    expect(m.push(ev(2, 'interact'), 1300)[0]!.viewer.honor).toBeUndefined();
  });

  it('只有 ENTRY_EFFECT 时，等待 2 秒后单独输出', () => {
    const m = new EnterMerger();
    m.push(ev(1, 'entry_effect', { guard: 2 }), 0);
    expect(m.flush(1999)).toEqual([]);
    expect(m.flush(2000).map((e) => e.viewer.guard)).toEqual([2]);
    expect(m.pendingCount).toBe(0);
  });

  it('已经输出过的人，窗口内的后续消息都丢弃', () => {
    const m = new EnterMerger();
    m.push(ev(1, 'interact'), 0);
    expect(m.push(ev(1, 'entry_effect'), 500)).toEqual([]);
    expect(m.flush(3000)).toEqual([]);
    expect(m.push(ev(1, 'interact'), 2999)).toEqual([]);
    expect(m.push(ev(1, 'interact'), 3000)).toHaveLength(1);
  });

  it('大航海等级合并时取较高（总督 1 最高）', () => {
    const m = new EnterMerger();
    m.push(ev(1, 'entry_effect', { guard: 1 }), 0);
    expect(m.push(ev(1, 'interact', { guard: 3 }), 100)[0]!.viewer.guard).toBe(1);
  });
});

describe('冷却（F-EN-09）', () => {
  it('按分钟：冷却期内为 true，到期后为 false', () => {
    const c = new Cooldowns();
    c.hit('k:1', 0, 5);
    expect(c.active('k:1', 5 * 60_000 - 1)).toBe(true);
    expect(c.active('k:1', 5 * 60_000)).toBe(false);
    expect(c.active('k:2', 0)).toBe(false);
  });

  it('0 分钟表示不冷却', () => {
    const c = new Cooldowns();
    c.hit('k', 0, 0);
    expect(c.active('k', 1)).toBe(false);
  });

  it('每场一次：换场次后重新计算，重启后可从记录恢复', () => {
    const o = new OncePerLive();
    o.setSession('s1');
    o.mark(1);
    expect(o.has(1)).toBe(true);
    o.setSession('s1');
    expect(o.has(1)).toBe(true);
    o.setSession('s2');
    expect(o.has(1)).toBe(false);
    o.restore('s3', [7, 8]);
    expect(o.has(8)).toBe(true);
  });
});

describe('能不能播（F-RU-06）', () => {
  const ok: DecideInput = { blocked: false, matched: true, paused: false, live: true, playWhenOffline: false, inCooldown: false, playedThisLive: false, overlayOnline: true };

  it('全部通过时播放', () => {
    expect(decide(ok)).toEqual({ play: true });
  });

  it('按固定顺序返回第一个不通过的原因', () => {
    const all: DecideInput = { blocked: true, matched: false, paused: true, live: false, playWhenOffline: false, inCooldown: true, playedThisLive: true, overlayOnline: false };
    expect(decide(all)).toEqual({ play: false, status: 'blacklist' });
    expect(decide({ ...all, blocked: false })).toMatchObject({ status: 'no_rule' });
    expect(decide({ ...all, blocked: false, matched: true })).toMatchObject({ status: 'paused' });
    expect(decide({ ...all, blocked: false, matched: true, paused: false })).toMatchObject({ status: 'offline' });
    expect(decide({ ...ok, playedThisLive: true, inCooldown: true })).toMatchObject({ status: 'once' });
    expect(decide({ ...ok, inCooldown: true })).toMatchObject({ status: 'cooldown' });
    expect(decide({ ...ok, overlayOnline: false })).toMatchObject({ status: 'no_overlay' });
  });

  it('排练模式下未开播也能播（F-PL-07）', () => {
    expect(decide({ ...ok, live: false, playWhenOffline: true })).toEqual({ play: true });
  });
});

describe('播放队列（F-PL-01 ~ 04）', () => {
  const item = (id: string, kind: QueueItem['kind'], t: number, jump = false): QueueItem => ({ id, kind, enqueuedAt: t, jump, payload: null });

  it('按优先级（上舰 > 礼物 > 进场 > 弹幕）和先来后到出队', () => {
    const q = new PlayQueue();
    q.enqueue(item('d', 'danmu', 1));
    q.enqueue(item('e1', 'enter', 2));
    q.enqueue(item('g', 'gift', 3));
    q.enqueue(item('e2', 'enter', 4));
    q.enqueue(item('s', 'guard', 5));
    expect([q.next(), q.next(), q.next(), q.next(), q.next()].map((x) => x?.id)).toEqual(['s', 'g', 'e1', 'e2', 'd']);
    expect(q.next()).toBeUndefined();
  });

  it('插队项排到队首', () => {
    const q = new PlayQueue();
    q.enqueue(item('s', 'guard', 1));
    q.enqueue(item('big', 'gift', 2, true));
    expect(q.next()?.id).toBe('big');
  });

  it('放到最前面的一项（被快捷播放打断的）：排在后来的插队项前面，队列满了也不会被挤掉', () => {
    const q = new PlayQueue(3);
    q.enqueue(item('e1', 'enter', 1));
    q.front(item('cut', 'danmu', 0));
    q.enqueue(item('big', 'gift', 2, true));
    expect(q.list().map((x) => x.id)).toEqual(['cut', 'big', 'e1']);
    const r = q.enqueue(item('d', 'danmu', 3));
    expect(r.dropped?.id).toBe('d');
    expect([q.next(), q.next()].map((x) => x?.id)).toEqual(['cut', 'big']);
  });

  it('队列满时丢弃优先级最低中最早进入的一项', () => {
    const q = new PlayQueue(3);
    q.enqueue(item('e1', 'enter', 1));
    q.enqueue(item('d1', 'danmu', 2));
    q.enqueue(item('d2', 'danmu', 3));
    const r = q.enqueue(item('g', 'gift', 4));
    expect(r.dropped?.id).toBe('d1');
    expect(q.list().map((x) => x.id)).toEqual(['g', 'e1', 'd2']);
  });

  it('新加入的项本身优先级最低时，丢弃的就是它', () => {
    const q = new PlayQueue(2);
    q.enqueue(item('g1', 'gift', 1));
    q.enqueue(item('g2', 'gift', 2));
    expect(q.enqueue(item('d', 'danmu', 3)).dropped?.id).toBe('d');
  });

  it('插队项不会被丢弃', () => {
    const q = new PlayQueue(1);
    q.enqueue(item('big', 'gift', 1, true));
    expect(q.enqueue(item('e', 'enter', 2)).dropped?.id).toBe('e');
    expect(q.size).toBe(1);
  });

  it('清空队列返回被清掉的项（F-PL-06）', () => {
    const q = new PlayQueue();
    q.enqueue(item('a', 'enter', 1));
    q.enqueue(item('b', 'enter', 2));
    expect(q.clear().map((x) => x.id)).toEqual(['a', 'b']);
    expect(q.size).toBe(0);
  });
  it('移出其中一项', () => {
    const q = new PlayQueue();
    q.enqueue(item('a', 'enter', 1));
    q.enqueue(item('b', 'enter', 2));
    expect(q.remove('a')?.id).toBe('a');
    expect(q.remove('x')).toBeUndefined();
    expect(q.list().map((x) => x.id)).toEqual(['b']);
  });
});

describe('长时间运行时自动清理过期记录', () => {
  it('进场合并的输出记录超过上限时清理已过窗口的', () => {
    const m = new EnterMerger(1600, 1000);
    const e = (uid: number): EnterEvent => ({ kind: 'enter', id: String(uid), ts: 0, source: 'interact', viewer: { uid, name: 'x', guard: 0, isMod: false, mystery: false } });
    for (let uid = 1; uid <= 5001; uid++) m.push(e(uid), 0);
    expect(m.push(e(1), 500)).toEqual([]);
    m.flush(2000);
    expect(m.push(e(2), 2000)).toHaveLength(1);
  });

  it('冷却记录超过上限时清理已到期的，未到期的保留', () => {
    const c = new Cooldowns();
    for (let i = 0; i < 20_000; i++) c.hit(`old:${i}`, 0, 1);
    c.hit('keep', 0, 10);
    c.hit('trigger', 2 * 60_000, 1);
    expect(c.active('keep', 2 * 60_000)).toBe(true);
    expect(c.active('old:1', 2 * 60_000)).toBe(false);
    c.clear();
    expect(c.active('keep', 2 * 60_000)).toBe(false);
  });
});
