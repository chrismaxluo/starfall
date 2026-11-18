import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GiftComboMerger } from '@starfall/core';
import type { HistoryPreview } from '@starfall/shared';
import { eventRaw, events, historySessionAliases, liveSessions } from '../db/schema.ts';
import { formFile, testApp } from '../testing.ts';

const base = '/api/backup/history';
const roomId = 30000;
const day = 86_400_000;
const now = Date.now();
const gift = { giftId: 31036, giftName: '小花花', unitPrice: 100, count: 2, paid: true };
const closing: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

async function setup(desktop = false) {
  const t = await testApp({}, desktop ? { STARFALL_DESKTOP: '1' } : {});
  closing.push(() => t.app.close());
  const req = desktop ? t.app.inject.bind(t.app) : await t.login();
  return { ...t, req };
}
type Target = Awaited<ReturnType<typeof setup>>;

function record(t: Target, ts: number, kind: typeof events.$inferInsert.kind, payload: unknown, sessionId?: number, rid = roomId, name = '观众') {
  return t.ctx.db.insert(events).values({
    ts, roomId: rid, sessionId, kind, uid: 10, uname: name,
    viewer: { uid: 10, name, isMod: false, guard: 0, mystery: false },
    status: 'no_rule', payload,
  }).returning({ id: events.id }).get().id;
}

function session(t: Target, ts: number, rid = roomId, endedAt: number | null = ts + 10_000) {
  return t.ctx.db.insert(liveSessions).values({ roomId: rid, startedAt: ts, endedAt }).returning({ id: liveSessions.id }).get().id;
}

async function fileOf(t: Target) {
  const r = await t.req({ method: 'GET', url: base + '/export' });
  expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
  expect(r.headers['content-disposition']).toMatch(/starfall-history-.*\.db/);
  return r.rawPayload;
}

async function review(t: Target, data: Buffer, name = 'starfall-history.db') {
  const r = await t.req({ method: 'POST', url: base + '/import', ...formFile(name, data) });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<HistoryPreview>();
}

async function confirm(t: Target, p: HistoryPreview) {
  return t.req({ method: 'POST', url: base + '/import/' + p.token });
}

describe('历史数据迁移', () => {
  it.each([false, true])('桌面和服务器双向互通（来源桌面=%s），保留目标历史并按原时间合并和分页', async (desktop) => {
    const source = await setup(desktop);
    const dest = await setup(!desktop);
    const old = now - 2 * day;
    const fresh = now - day;
    const srcSession = session(source, old, roomId, null);
    const dstSession = session(dest, fresh);
    expect(srcSession).toBe(dstSession);
    record(source, old + 1000, 'gift', gift, srcSession, roomId, '旧昵称');
    record(source, old + 1000, 'gift', gift, srcSession, roomId, '旧昵称'); // 同秒的两笔礼物都应保留
    record(source, old + 2000, 'danmu', { text: '历史弹幕' }, srcSession);
    record(source, old + 3000, 'guard', { level: 3, months: 1, op: 'open', price: 10_000 }, srcSession);
    record(source, old + 4000, 'sc', { text: '历史醒目留言', scId: '123', price: 30 }, srcSession);
    record(source, old + 1000, 'danmu', { text: '其他直播间' }, undefined, 40000);
    const newest = record(dest, fresh + 1000, 'gift', { ...gift, count: 3 }, dstSession, roomId, '新昵称');
    dest.ctx.settings.set('retentionDays', 180);
    const feed = vi.fn();
    dest.ctx.log.onChange(feed);
    const config = dest.ctx.io.export();
    const bytes = await fileOf(source);

    const disk = path.join(source.dataDir, 'isolated.db');
    fs.writeFileSync(disk, bytes);
    const exported = new Database(disk, { readonly: true });
    try {
      expect(exported.prepare("select name from sqlite_schema where type='table' order by name").pluck().all()).toEqual(['events', 'history_info', 'live_sessions']);
    } finally {
      exported.close();
    }

    const p = await review(dest, bytes);
    expect(p.plan.events).toMatchObject({ gift: { added: 2 }, danmu: { added: 2 }, guard: { added: 1 }, sc: { added: 1 } });
    expect(p.plan.sessions).toEqual({ added: 1, existing: 0 });
    expect(dest.ctx.log.query({ roomId }).events).toHaveLength(1);
    const result = await confirm(dest, p);
    expect(result.statusCode, result.body).toBe(200);
    const applied = result.json();
    expect(fs.existsSync(path.join(dest.dataDir, 'backups', 'starfall-' + applied.backup + '.db'))).toBe(true);
    expect(dest.ctx.io.export()).toMatchObject({ settings: config.settings, rules: config.rules, outputs: config.outputs });

    expect(feed).not.toHaveBeenCalled();
    const page = dest.ctx.log.query({ roomId, limit: 2 });
    expect(page.events.map((e) => e.ts)).toEqual([fresh + 1000, old + 4000]);
    expect(page.events[0]?.id).toBe(newest);
    expect(dest.ctx.log.query({ roomId, cursor: page.nextCursor! }).events.map((e) => e.kind)).toEqual(['guard', 'danmu', 'gift', 'gift']);
    expect(dest.ctx.log.query({ roomId: 40000 }).events).toHaveLength(1);
    const [top, historical] = dest.ctx.log.sessionList(roomId);
    expect(top).toMatchObject({ id: dstSession, startedAt: fresh, gifts: 1 });
    expect(historical).toMatchObject({ startedAt: old, endedAt: old + 4001, gifts: 4 });
    expect(historical?.id).not.toBe(srcSession);
    expect(dest.ctx.live.lastSession(roomId)?.id).toBe(dstSession);
    expect(dest.ctx.log.giftRank(roomId, old, old + day)).toMatchObject({ gold: 40_400, rows: [{ times: 2, guards: 1, scs: 1 }] });
    expect(dest.ctx.log.giftRank(roomId, old, null).rows[0]?.viewer).toMatchObject({ name: '新昵称' });

    const again = await review(dest, bytes);
    expect(again.plan.events.gift).toMatchObject({ added: 0, duplicate: 2 });
    expect(again.plan.events.danmu).toMatchObject({ added: 0, duplicate: 2 });
    expect(again.plan.sessions).toEqual({ added: 0, existing: 1 });
    expect((await confirm(dest, again)).statusCode).toBe(200);
    expect(dest.ctx.log.giftRank(roomId, old, null).gold).toBe(40_700);
  });

  it('旧版完整备份会按可靠编号去重，并单独提示疑似重复与保留期之外的记录', async () => {
    const source = await setup();
    const dest = await setup();
    const recent = now - 2 * day;
    record(dest, recent, 'sc', { text: '同一条', price: 30, scId: '123' });
    record(dest, recent, 'gift', gift);
    record(source, recent + 30_000, 'sc', { text: '同一条', price: 30, scId: '123' });
    const guard = { level: 3, months: 1, op: 'open', price: 10_000 };
    const srcGuard = record(source, recent + 60_000, 'guard', guard);
    const dstGuard = record(dest, recent, 'guard', guard);
    const raw = { data: { pay_info: { payflow_id: 'same-payment' } } };
    source.ctx.db.insert(eventRaw).values({ id: srcGuard, ts: recent + 60_000, raw }).run();
    dest.ctx.db.insert(eventRaw).values({ id: dstGuard, ts: recent, raw }).run();
    record(source, recent + 2000, 'gift', { ...gift, count: 3 });
    record(source, now - 120 * day, 'gift', gift);
    record(source, recent, 'danmu', { text: '独立历史记录' });
    const backup = await source.ctx.backups.run();
    const disk = path.join(source.dataDir, 'backups', 'starfall-' + backup.stamp + '.db');
    const old = new Database(disk);
    try {
      old.exec('drop index events_history_key; drop index events_platform_key; alter table events drop column history_key; alter table events drop column platform_key;');
    } finally {
      old.close();
    }
    const p = await review(dest, fs.readFileSync(disk), 'starfall-old-backup.db');
    expect(p.plan.events.gift).toEqual({ added: 0, duplicate: 0, overlap: 1, expired: 1 });
    expect(p.plan.events.sc.duplicate).toBe(1);
    expect(p.plan.events.guard.duplicate).toBe(1);
    expect(p.plan.events.danmu.added).toBe(1);
    expect((await confirm(dest, p)).statusCode).toBe(200);
    expect(dest.ctx.log.query({ roomId }).events).toHaveLength(4);
    expect(dest.ctx.log.giftRank(roomId, 0, null).gold).toBe(40_200);
  });

  it('不同设备从不同时间开始记录同一段礼物连击，不重复累计金额', async () => {
    const source = await setup();
    const dest = await setup();
    const start = now - day;
    const sourceCombo = new GiftComboMerger();
    const destCombo = new GiftComboMerger();
    for (let seconds = 0; seconds <= 24; seconds += 2) {
      const ts = start + seconds * 1000;
      const event = {
        ...gift, count: 1, id: `g${seconds}`, kind: 'gift' as const, ts,
        viewer: { uid: 10, name: '观众', guard: 0 as const, isMod: false, mystery: false },
      };
      sourceCombo.push(event, ts);
      if (seconds >= 18) destCombo.push(event, ts);
    }
    const [full] = sourceCombo.flush(start + 30_000);
    const [partial] = destCombo.flush(start + 30_000);
    expect([full?.count, partial?.count]).toEqual([13, 4]);
    record(source, full!.ts, 'gift', { ...gift, count: full!.count });
    record(dest, partial!.ts, 'gift', { ...gift, count: partial!.count });
    record(source, start + 70_000, 'gift', { ...gift, count: 1 });

    const p = await review(dest, await fileOf(source));
    expect(p.plan.events.gift).toEqual({ added: 1, duplicate: 0, overlap: 1, expired: 0 });
    expect((await confirm(dest, p)).statusCode).toBe(200);
    expect(dest.ctx.log.giftRank(roomId, start, null).gold).toBe(500);
  });

  it('起播记录稍有偏差时合并唯一重叠的已结束场次，并保留独立场次', async () => {
    const source = await setup();
    const dest = await setup();
    const start = now - day;
    const end = start + 30 * 60_000;
    const earlier = session(source, start, roomId, end);
    const later = session(dest, start + 120_000, roomId, end + 1000);
    const previous = session(dest, start - 240_000, roomId, start - 15_000);
    record(source, start + 60_000, 'gift', gift, earlier);
    record(dest, start + 180_000, 'gift', gift, later);

    const bytes = await fileOf(source);
    const p = await review(dest, bytes);
    expect(p.plan.sessions).toEqual({ added: 0, existing: 1 });
    expect(dest.ctx.live.lastSession(roomId)?.startedAt).toBe(start + 120_000);
    expect((await confirm(dest, p)).statusCode).toBe(200);
    expect(dest.ctx.log.sessionList(roomId).map((s) => [s.id, s.gifts])).toEqual([[later, 2], [previous, 0]]);
    const last = dest.ctx.live.lastSession(roomId)!;
    expect(last).toMatchObject({ id: later, startedAt: start, endedAt: end + 1000 });
    expect(dest.ctx.log.giftRank(roomId, last.startedAt, last.endedAt).gold).toBe(400);
    const repeat = await review(dest, bytes);
    expect(repeat.plan.sessions).toEqual({ added: 0, existing: 1 });
    expect(repeat.plan.events.gift.duplicate).toBe(1);
  });

  it('两场均可能匹配或场次仍在直播时，保留独立历史场次', async () => {
    const source = await setup();
    const dest = await setup();
    const start = now - day;
    const end = start + 30 * 60_000;
    session(source, start, roomId, end);
    const active = session(dest, start + 1000, roomId, null);
    const first = session(dest, start + 2000, roomId, end);
    const second = session(dest, start + 3000, roomId, end);

    const p = await review(dest, await fileOf(source));
    expect(p.plan.sessions).toEqual({ added: 1, existing: 0 });
    expect((await confirm(dest, p)).statusCode).toBe(200);
    expect(dest.ctx.log.sessionList(roomId)).toMatchObject([
      { id: second, startedAt: start + 3000 }, { id: first, startedAt: start + 2000 },
      { id: active, startedAt: start + 1000, endedAt: null }, { startedAt: start },
    ]);
  });

  it('重复导入时，精确匹配的场次不会妨碍其他场次匹配', async () => {
    const source = await setup();
    const dest = await setup();
    const start = now - day;
    const end = start + 30 * 60_000;
    const same = session(source, start + 60_000, roomId, end);
    session(source, start + 360_000, roomId, end);
    session(dest, start, roomId, end);
    record(source, start + 100_000, 'gift', gift, same);
    const file = await fileOf(source);
    const first = await review(dest, file);
    expect(first.plan.sessions).toEqual({ added: 1, existing: 1 });
    expect((await confirm(dest, first)).statusCode).toBe(200);
    const repeat = await review(dest, file);
    expect(repeat.plan.sessions).toEqual({ added: 0, existing: 2 });
    expect(repeat.plan.events.gift.duplicate).toBe(1);
  });

  it('场次时间扩大产生新的候选时，重导仍沿用上次确认的场次', async () => {
    const source = await setup();
    const dest = await setup();
    const start = now - day;
    const first = session(source, start + 150_000, roomId, start + 1_800_000);
    const second = session(source, start + 450_000, roomId, start + 1_720_000);
    const targetFirst = session(dest, start, roomId, start + 1_770_000);
    const targetSecond = session(dest, start + 400_000, roomId, start + 1_450_000);
    record(source, start + 200_000, 'gift', gift, first);
    record(source, start + 500_000, 'gift', gift, second);

    const file = await fileOf(source);
    const p = await review(dest, file);
    expect(p.plan.sessions).toEqual({ added: 0, existing: 2 });
    expect(dest.ctx.db.select().from(historySessionAliases).all()).toHaveLength(0);
    expect((await confirm(dest, p)).statusCode).toBe(200);
    expect(dest.ctx.log.sessionList(roomId)).toMatchObject([
      { id: targetSecond, endedAt: start + 1_720_000, gifts: 1 },
      { id: targetFirst, endedAt: start + 1_800_000, gifts: 1 },
    ]);
    const repeat = await review(dest, file);
    expect(repeat.plan.sessions).toEqual({ added: 0, existing: 2 });
    expect(repeat.plan.events.gift.duplicate).toBe(2);
  });

  it.each([false, true])('醒目留言小数金额保留精度（完整备份=%s）', async (fullBackup) => {
    const source = await setup();
    const dest = await setup();
    const payload = { text: '小数金额', price: 30.5, scId: 'decimal-sc' };
    record(source, now - day, 'sc', payload);
    let file: Buffer;
    if (fullBackup) {
      const backup = await source.ctx.backups.run();
      file = fs.readFileSync(path.join(source.dataDir, 'backups', `starfall-${backup.stamp}.db`));
    } else {
      file = await fileOf(source);
    }
    const p = await review(dest, file);
    expect(p.plan.events.sc.added).toBe(1);
    expect((await confirm(dest, p)).statusCode).toBe(200);
    expect(dest.ctx.log.query({ roomId }).events[0]?.payload).toEqual(payload);
    expect(dest.ctx.log.giftRank(roomId, 0, null).gold).toBe(30_500);
  });

  it('确认时发现新记录与预览重叠会回滚，并要求重新确认', async () => {
    const source = await setup();
    const dest = await setup();
    const ts = now - day;
    const sid = session(source, ts);
    record(source, ts + 100, 'danmu', { text: '原本应新增' }, sid);
    record(source, ts + 500, 'gift', gift, sid);
    const p = await review(dest, await fileOf(source));
    record(dest, ts + 900, 'gift', gift);
    const rejected = await confirm(dest, p);
    expect(rejected.statusCode, rejected.body).toBe(409);
    expect(rejected.json().error).toMatchObject({ code: 'history_changed', details: { events: { gift: { overlap: 1 }, danmu: { added: 1 } } } });
    expect(dest.ctx.log.query({ roomId }).events).toHaveLength(1);
    expect(dest.ctx.log.sessionList(roomId)).toHaveLength(0);
    expect((await confirm(dest, p)).statusCode).toBe(200);
    expect(dest.ctx.log.query({ roomId }).events.map((e) => e.kind)).toEqual(['gift', 'danmu']);
  });

  it('合并同场直播的较晚礼物后，本场时间范围也能统计到', async () => {
    const source = await setup();
    const dest = await setup();
    const start = now - day;
    const srcId = session(source, start, roomId, start + 200_000);
    const dstId = session(dest, start, roomId, start + 60_000);
    record(source, start + 90_000, 'gift', gift, srcId);
    const p = await review(dest, await fileOf(source));
    expect(p.plan.sessions).toEqual({ added: 0, existing: 1 });
    expect((await confirm(dest, p)).statusCode).toBe(200);
    const last = dest.ctx.live.lastSession(roomId)!;
    expect(last).toMatchObject({ id: dstId, endedAt: start + 90_001 });
    expect(dest.ctx.log.giftRank(roomId, last.startedAt, last.endedAt).gold).toBe(200);
  });

  it('仅后台可访问，拒绝无效数据库与配置文件', async () => {
    const t = await setup();
    expect((await t.app.inject({ method: 'GET', url: base + '/export' })).statusCode).toBe(401);
    expect((await t.req({ method: 'POST', url: base + '/import', ...formFile('wrong.json', '{}') })).statusCode).toBe(415);
    const r = await t.req({ method: 'POST', url: base + '/import', ...formFile('broken.db', 'not sqlite') });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_history');
  });

  it('确认后清理一个被占用的临时文件失败，仍能继续使用导入功能', async () => {
    const source = await setup();
    const dest = await setup();
    record(source, now - day, 'gift', gift);
    const bytes = await fileOf(source);
    const p = await review(dest, bytes);
    const rm = fs.rmSync;
    const locked = vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file).endsWith('history-import-' + p.token + '.db')) throw Object.assign(new Error('locked'), { code: 'EPERM' });
      rm(file, options);
    });
    try {
      expect((await confirm(dest, p)).statusCode).toBe(200);
      const next = await review(dest, bytes);
      expect(next.plan.events.gift).toMatchObject({ added: 0, duplicate: 1 });
    } finally {
      locked.mockRestore();
    }
  });
});
