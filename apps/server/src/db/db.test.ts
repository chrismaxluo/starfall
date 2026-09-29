import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb } from './index.ts';
import { effects, outputs, ruleEnterBands, ruleEnterTiers, ruleExclusive, ruleGiftBands, ruleGuard, settings } from './schema.ts';
import { BUILTIN_EFFECTS, RETIRED_EFFECTS, seed } from './seed.ts';

describe('数据库', () => {
  it('事件记录翻页（按直播间、按类型，按编号倒序）走索引，不需要把整个直播间的事件取出来再排序', () => {
    const db = openDb(':memory:');
    const plan = (q: string) => (db.$client.prepare(`explain query plan ${q}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
    const byRoom = plan('select * from events where room_id = 1 and id < 100 order by id desc limit 51');
    expect(byRoom).toContain('events_room_id');
    expect(byRoom).not.toContain('TEMP B-TREE');
    const byKind = plan("select * from events where room_id = 1 and kind = 'gift' order by id desc limit 51");
    expect(byKind).toContain('events_room_kind_id');
    expect(byKind).not.toContain('TEMP B-TREE');
  });

  it('迁移后写入初始数据：内置素材、5 个身份档位、2 个粉丝牌分档、1 个竖屏输出', () => {
    const db = openDb(':memory:');
    seed(db);
    expect(db.select().from(effects).all().map((e) => e.name)).toEqual(BUILTIN_EFFECTS.map((e) => e.name));
    expect(db.select().from(ruleEnterTiers).all()).toHaveLength(5);
    expect(db.select().from(ruleEnterTiers).where(eq(ruleEnterTiers.tier, 'nor')).get()?.enabled).toBe(false);
    expect(db.select().from(ruleEnterBands).all().map((b) => b.fromLevel).sort((a, b) => a - b)).toEqual([1, 21]);
    const out = db.select().from(outputs).all();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ orient: 'portrait', width: 1080, height: 1920, safeTop: 12, safeBottom: 40, marginX: 9 });
    expect(out[0]!.key.length).toBeGreaterThanOrEqual(20);
  });

  it('重复执行不会重复写入，也不会覆盖已修改的数据', () => {
    const db = openDb(':memory:');
    seed(db);
    db.update(settings).set({ value: true }).where(eq(settings.key, 'paused')).run();
    db.update(ruleEnterTiers).set({ cooldownMin: 99 }).where(eq(ruleEnterTiers.tier, 'cap')).run();
    seed(db);
    expect(db.select().from(effects).all()).toHaveLength(BUILTIN_EFFECTS.length);
    expect(db.select().from(settings).where(eq(settings.key, 'paused')).get()?.value).toBe(true);
    expect(db.select().from(ruleEnterTiers).where(eq(ruleEnterTiers.tier, 'cap')).get()?.cooldownMin).toBe(99);
    expect(db.select().from(outputs).all()).toHaveLength(1);
  });

  it('内置素材的文案升级后同步成新版本（内置素材在后台只读）；复制出来的素材不受影响', () => {
    const db = openDb(':memory:');
    seed(db);
    db.update(effects).set({ texts: { enter: ['旧文案'] } }).where(eq(effects.name, '晶耀')).run();
    db.insert(effects).values({ name: '我的星冕', builtin: false, style: 'glass-big', texts: { enter: ['我自己的'] } }).run();
    seed(db);
    expect(db.select().from(effects).where(eq(effects.name, '晶耀')).get()?.texts).toEqual(BUILTIN_EFFECTS.find((e) => e.name === '晶耀')!.texts);
    expect(db.select().from(effects).where(eq(effects.name, '我的星冕')).get()?.texts).toEqual({ enter: ['我自己的'] });
  });

  it('升级：下线的内置素材在规则里换成替代素材后删除；以前复制的副本保留、换成替代样式', () => {
    const db = openDb(':memory:');
    seed(db);
    // 模拟旧版本的数据：还有星冕、巡场，规则在用它们；还有一个星冕的副本
    const star = db.insert(effects).values({ name: '星冕', builtin: true, style: 'star', texts: { enter: ['x'] } }).returning().get();
    const patrol = db.insert(effects).values({ name: '巡场', builtin: true, style: 'patrol', texts: { enter: ['x'] } }).returning().get();
    db.insert(effects).values({ name: '我的星冕', builtin: false, style: 'star', texts: { enter: ['我的'] } }).run();
    db.update(ruleGiftBands).set({ effectId: star.id }).where(eq(ruleGiftBands.fromGold, 100_000)).run();
    db.update(ruleEnterTiers).set({ effectId: patrol.id }).where(eq(ruleEnterTiers.tier, 'mod')).run();
    db.update(ruleGuard).set({ renewEffectId: star.id }).where(eq(ruleGuard.tier, 'gov')).run();
    seed(db);
    const byName = (n: string) => db.select().from(effects).where(eq(effects.name, n)).get();
    expect(byName('星冕')).toBeUndefined();
    expect(byName('巡场')).toBeUndefined();
    expect(db.select().from(ruleGiftBands).where(eq(ruleGiftBands.fromGold, 100_000)).get()?.effectId).toBe(byName('晶耀')!.id);
    expect(db.select().from(ruleEnterTiers).where(eq(ruleEnterTiers.tier, 'mod')).get()?.effectId).toBe(byName('晶巡')!.id);
    expect(db.select().from(ruleGuard).where(eq(ruleGuard.tier, 'gov')).get()?.renewEffectId).toBe(byName('晶耀')!.id);
    expect(byName('我的星冕')).toMatchObject({ builtin: false, style: 'glass-big', texts: { enter: ['我的'] } });
    // 替代素材都是现有的内置素材
    for (const r of RETIRED_EFFECTS) expect(BUILTIN_EFFECTS.some((e) => e.name === r.replacedBy)).toBe(true);
  });

  it('升级：已有素材的渐入渐出时长按以前的比例（总时长的 5% 和 8%）', () => {
    // 先迁移到上一个版本，放两个旧素材，再用完整迁移打开
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-mig-'));
    const src = path.resolve(import.meta.dirname, '../../drizzle');
    fs.cpSync(src, path.join(dir, 'drizzle'), { recursive: true });
    const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta/_journal.json'), 'utf8'));
    const last = journal.entries.pop();
    fs.rmSync(path.join(dir, 'drizzle', `${last.tag}.sql`));
    fs.writeFileSync(path.join(dir, 'drizzle/meta/_journal.json'), JSON.stringify(journal));
    const file = path.join(dir, 'old.db');
    const old = new Database(file);
    migrate(drizzle(old), { migrationsFolder: path.join(dir, 'drizzle') });
    old.exec(`insert into assets (id, sha256, kind, filename, ext, mime, size, duration_ms) values (1, 'a', 'video', 'v.mp4', 'mp4', 'video/mp4', 1, 30000), (2, 'b', 'image', 's.png', 'png', 'image/png', 1, null);
      insert into effects (name, asset_id, texts, duration_ms) values ('视频', 1, '{"enter":["x"]}', 30000), ('图片', 2, '{"enter":["x"]}', 4000);`);
    old.close();
    const db = openDb(file);
    const rows = db.select().from(effects).where(eq(effects.builtin, false)).all();
    const by = (n: string) => rows.find((r) => r.name === n)!;
    expect(by('视频')).toMatchObject({ fadeInMs: 1500, fadeOutMs: 2400 });
    expect(by('图片')).toMatchObject({ fadeInMs: 200, fadeOutMs: 320 });
    db.$client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('被规则引用的素材不能删除（F-AS-14）', () => {
    const db = openDb(':memory:');
    seed(db);
    const used = db.select().from(effects).where(eq(effects.name, '晶耀')).get()!;
    expect(() => db.delete(effects).where(eq(effects.id, used.id)).run()).toThrow(/FOREIGN KEY/);
  });

  it('专属用户必须指向存在的素材', () => {
    const db = openDb(':memory:');
    expect(() => db.insert(ruleExclusive).values({ uid: 1, effectId: 9999, cooldownMin: 10, until: null, enabled: true }).run()).toThrow(/FOREIGN KEY/);
  });
});
