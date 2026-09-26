// 弹幕、礼物、上舰规则（需求 F-DM、F-GF、F-GD）
import { asc, eq, sql } from 'drizzle-orm';
import { DanmuRuleSchema, GiftRulesSchema, GuardRulesSchema } from '@starfall/shared';
import type { DanmuRule, GiftRules, GuardRules } from '@starfall/shared';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { ruleDanmu, ruleGiftBands, ruleGiftSpecific, ruleGuard } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { checkEffectIds } from './rules.ts';
import type { SettingsStore } from './settings.ts';

export const DanmuInputSchema = DanmuRuleSchema.omit({ id: true }).strict();
export const DanmuPatchSchema = DanmuInputSchema.partial().strict();
export const GiftRulesInputSchema = GiftRulesSchema;
export const GuardRulesInputSchema = GuardRulesSchema;
export const DanmuOrderSchema = z.object({ ids: z.array(z.number().int().positive()).max(500) }).strict();

const toDanmu = (r: typeof ruleDanmu.$inferSelect): DanmuRule => ({
  id: r.id,
  keywords: r.keywords,
  mode: r.mode,
  who: r.who,
  effectId: r.effectId,
  globalCdSec: r.globalCdSec,
  userCdMin: r.userCdMin,
  enabled: r.enabled,
});

/** 关键词去掉首尾空格、去重 */
const cleanKeywords = (k: string[]) => [...new Set(k.map((x) => x.trim()).filter(Boolean))];

export class DanmuRuleStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  list(): DanmuRule[] {
    return this.db.select().from(ruleDanmu).orderBy(asc(ruleDanmu.sort), asc(ruleDanmu.id)).all().map(toDanmu);
  }

  get(id: number): DanmuRule {
    const r = this.db.select().from(ruleDanmu).where(eq(ruleDanmu.id, id)).get();
    if (!r) throw new HttpError(404, 'not_found', '弹幕规则不存在');
    return toDanmu(r);
  }

  create(input: Omit<DanmuRule, 'id'>): DanmuRule {
    checkEffectIds(this.db, [input.effectId]);
    const max = this.db.select({ m: sql<number>`coalesce(max(${ruleDanmu.sort}), 0)` }).from(ruleDanmu).get()!.m;
    const r = this.db.insert(ruleDanmu).values({ ...input, keywords: cleanKeywords(input.keywords), sort: max + 1 }).returning().get();
    return toDanmu(r);
  }

  update(id: number, patch: Partial<Omit<DanmuRule, 'id'>>): DanmuRule {
    this.get(id);
    checkEffectIds(this.db, [patch.effectId]);
    const values = { ...patch, ...(patch.keywords ? { keywords: cleanKeywords(patch.keywords) } : {}) };
    if (values.keywords && !values.keywords.length) throw new HttpError(400, 'invalid_input', '至少保留一个关键词');
    this.db.update(ruleDanmu).set(values).where(eq(ruleDanmu.id, id)).run();
    return this.get(id);
  }

  remove(id: number): void {
    if (this.db.delete(ruleDanmu).where(eq(ruleDanmu.id, id)).run().changes === 0) throw new HttpError(404, 'not_found', '弹幕规则不存在');
  }

  /** 调整顺序：ids 为新的完整顺序 */
  reorder(ids: number[]): DanmuRule[] {
    const all = this.list().map((r) => r.id);
    if (ids.length !== all.length || new Set(ids).size !== ids.length || !ids.every((id) => all.includes(id))) {
      throw new HttpError(400, 'invalid_input', '顺序里的规则和现有规则不一致，请刷新后再试');
    }
    this.db.transaction((tx) => ids.forEach((id, i) => tx.update(ruleDanmu).set({ sort: i + 1 }).where(eq(ruleDanmu.id, id)).run()));
    return this.list();
  }
}

export class GiftRuleStore {
  private readonly db: Db;
  private readonly settings: SettingsStore;
  constructor(db: Db, settings: SettingsStore) {
    this.db = db;
    this.settings = settings;
  }

  get(): GiftRules {
    return {
      specific: this.db
        .select()
        .from(ruleGiftSpecific)
        .orderBy(asc(ruleGiftSpecific.sort), asc(ruleGiftSpecific.giftId))
        .all()
        .map((r) => ({ giftId: r.giftId, giftName: r.giftName, effectId: r.effectId, enabled: r.enabled })),
      bands: this.db
        .select()
        .from(ruleGiftBands)
        .all()
        .sort((a, b) => b.fromGold - a.fromGold)
        .map((r) => ({ fromGold: r.fromGold, effectId: r.effectId, enabled: r.enabled })),
      comboEnabled: this.settings.get('giftComboEnabled'),
      comboSec: this.settings.get('giftComboSec'),
    };
  }

  set(r: GiftRules): GiftRules {
    checkEffectIds(this.db, [...r.specific.map((x) => x.effectId), ...r.bands.map((x) => x.effectId)]);
    this.db.transaction((tx) => {
      tx.delete(ruleGiftSpecific).run();
      if (r.specific.length) tx.insert(ruleGiftSpecific).values(r.specific.map((x, i) => ({ ...x, sort: i }))).run();
      tx.delete(ruleGiftBands).run();
      tx.insert(ruleGiftBands).values(r.bands).run();
    });
    this.settings.set('giftComboEnabled', r.comboEnabled);
    this.settings.set('giftComboSec', r.comboSec);
    return this.get();
  }
}

export class GuardRuleStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  get(): GuardRules {
    const rows = new Map(this.db.select().from(ruleGuard).all().map((r) => [r.tier, r]));
    const one = (t: 'gov' | 'adm' | 'cap') => {
      const r = rows.get(t);
      return r ? { openEffectId: r.openEffectId, renewEffectId: r.renewEffectId, enabled: r.enabled } : { openEffectId: null, renewEffectId: null, enabled: false };
    };
    return { gov: one('gov'), adm: one('adm'), cap: one('cap') };
  }

  set(r: GuardRules): GuardRules {
    checkEffectIds(this.db, (['gov', 'adm', 'cap'] as const).flatMap((t) => [r[t].openEffectId, r[t].renewEffectId]));
    this.db.transaction((tx) => {
      for (const t of ['gov', 'adm', 'cap'] as const) tx.insert(ruleGuard).values({ tier: t, ...r[t] }).onConflictDoUpdate({ target: ruleGuard.tier, set: r[t] }).run();
    });
    return this.get();
  }
}
