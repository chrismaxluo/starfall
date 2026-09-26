import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from './index.ts';
import { effects, outputs, ruleEnterBands, ruleEnterTiers, ruleExclusive, settings } from './schema.ts';
import { BUILTIN_EFFECTS, seed } from './seed.ts';

describe('数据库', () => {
  it('迁移后写入初始数据：8 个内置素材、5 个身份档位、2 个粉丝牌分档、1 个竖屏输出', () => {
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
    expect(db.select().from(effects).all()).toHaveLength(8);
    expect(db.select().from(settings).where(eq(settings.key, 'paused')).get()?.value).toBe(true);
    expect(db.select().from(ruleEnterTiers).where(eq(ruleEnterTiers.tier, 'cap')).get()?.cooldownMin).toBe(99);
    expect(db.select().from(outputs).all()).toHaveLength(1);
  });

  it('内置素材的文案升级后同步成新版本（内置素材在后台只读）；复制出来的素材不受影响', () => {
    const db = openDb(':memory:');
    seed(db);
    db.update(effects).set({ texts: { enter: ['旧文案'] } }).where(eq(effects.name, '星冕')).run();
    db.insert(effects).values({ name: '我的星冕', builtin: false, style: 'star', texts: { enter: ['我自己的'] } }).run();
    seed(db);
    expect(db.select().from(effects).where(eq(effects.name, '星冕')).get()?.texts).toEqual(BUILTIN_EFFECTS[0]!.texts);
    expect(db.select().from(effects).where(eq(effects.name, '我的星冕')).get()?.texts).toEqual({ enter: ['我自己的'] });
  });

  it('被规则引用的素材不能删除（F-AS-14）', () => {
    const db = openDb(':memory:');
    seed(db);
    const star = db.select().from(effects).where(eq(effects.name, '星冕')).get()!;
    expect(() => db.delete(effects).where(eq(effects.id, star.id)).run()).toThrow(/FOREIGN KEY/);
  });

  it('专属用户必须指向存在的素材', () => {
    const db = openDb(':memory:');
    expect(() => db.insert(ruleExclusive).values({ uid: 1, effectId: 9999, cooldownMin: 10, until: null, enabled: true }).run()).toThrow(/FOREIGN KEY/);
  });
});
