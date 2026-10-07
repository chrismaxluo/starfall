// 进场规则（需求 F-EN-01 ~ 08）：身份档位、粉丝牌分档、荣耀等级分档、冷却方式，以及专属用户。
import { eq, inArray } from 'drizzle-orm';
import { ExclusiveSchema, HonorBandSchema, MedalBandSchema, TIERS, TierRuleSchema } from '@starfall/shared';
import type { EnterRules, Exclusive, HonorBand, MedalBand, Tier, TierRule } from '@starfall/shared';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { effects, ruleEnterBands, ruleEnterHonorBands, ruleEnterTiers, ruleExclusive } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { SettingsStore } from './settings.ts';
import type { ViewerStore } from './viewers.ts';

/** 规则里选的素材必须存在，否则返回 400 */
export function checkEffectIds(db: Db, ids: Array<number | null | undefined>): void {
  const want = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  if (!want.length) return;
  const have = new Set(db.select({ id: effects.id }).from(effects).where(inArray(effects.id, want)).all().map((r) => r.id));
  const missing = want.filter((id) => !have.has(id));
  if (missing.length) throw new HttpError(400, 'invalid_effect', `所选的素材不存在（ID ${missing.join('、')}）`);
}

export const EnterBaseSchema = z
  .object({
    tiers: z.object({ gov: TierRuleSchema, adm: TierRuleSchema, cap: TierRuleSchema, mod: TierRuleSchema, nor: TierRuleSchema }).strict(),
    bands: z.array(MedalBandSchema.strict()).min(1).max(20),
    honorBands: z.array(HonorBandSchema.strict()).max(20),
    cooldownMode: z.enum(['minutes', 'oncePerLive']),
  })
  .strict()
  .superRefine((r, ctx) => {
    const levels = r.bands.map((b) => b.fromLevel);
    if (new Set(levels).size !== levels.length) ctx.addIssue({ code: 'custom', path: ['bands'], message: '粉丝牌分档的起始等级不能重复' });
    const honors = r.honorBands.map((b) => b.fromLevel);
    if (new Set(honors).size !== honors.length) ctx.addIssue({ code: 'custom', path: ['honorBands'], message: '荣耀等级分档的起始等级不能重复' });
  });
export type EnterBase = z.infer<typeof EnterBaseSchema>;

export const ExclusiveInputSchema = ExclusiveSchema.strict();
export const ExclusivePatchSchema = ExclusiveSchema.omit({ uid: true }).partial().strict();

export interface ExclusiveDto extends Exclusive {
  name: string | null;
  face: string | null;
  /** 在当前直播间是大航海几级（0 不是或不知道） */
  guard: number;
  createdAt: number;
}

export class EnterRuleStore {
  private readonly db: Db;
  private readonly settings: SettingsStore;
  private readonly viewers: ViewerStore;

  constructor(db: Db, settings: SettingsStore, viewers: ViewerStore) {
    this.db = db;
    this.settings = settings;
    this.viewers = viewers;
  }

  base(): EnterBase {
    const rows = new Map(this.db.select().from(ruleEnterTiers).all().map((t) => [t.tier, t]));
    const tier = (k: Tier): TierRule => {
      const t = rows.get(k);
      return t ? { effectId: t.effectId, cooldownMin: t.cooldownMin, enabled: t.enabled } : { effectId: null, cooldownMin: 10, enabled: false };
    };
    const bands: MedalBand[] = this.db
      .select()
      .from(ruleEnterBands)
      .all()
      .sort((a, b) => b.fromLevel - a.fromLevel)
      .map((b) => ({ fromLevel: b.fromLevel, effectId: b.effectId, cooldownMin: b.cooldownMin, enabled: b.enabled }));
    const honorBands: HonorBand[] = this.db
      .select()
      .from(ruleEnterHonorBands)
      .all()
      .sort((a, b) => b.fromLevel - a.fromLevel)
      .map((b) => ({ fromLevel: b.fromLevel, effectId: b.effectId, cooldownMin: b.cooldownMin, enabled: b.enabled }));
    return {
      tiers: { gov: tier('gov'), adm: tier('adm'), cap: tier('cap'), mod: tier('mod'), nor: tier('nor') },
      bands,
      honorBands,
      cooldownMode: this.settings.get('cooldownMode'),
    };
  }

  /** 匹配用的完整规则 */
  full(): EnterRules {
    const exclusives = this.db.select().from(ruleExclusive).all().map(toExclusive);
    return { ...this.base(), exclusives };
  }

  private checkEffects(ids: Array<number | null | undefined>): void {
    checkEffectIds(this.db, ids);
  }

  setBase(b: EnterBase): EnterBase {
    this.checkEffects([...TIERS.map((t) => b.tiers[t].effectId), ...b.bands.map((x) => x.effectId), ...b.honorBands.map((x) => x.effectId)]);
    this.db.transaction((tx) => {
      for (const tier of TIERS) {
        const v = b.tiers[tier];
        tx.insert(ruleEnterTiers).values({ tier, ...v }).onConflictDoUpdate({ target: ruleEnterTiers.tier, set: v }).run();
      }
      tx.delete(ruleEnterBands).run();
      tx.insert(ruleEnterBands).values(b.bands).run();
      tx.delete(ruleEnterHonorBands).run();
      if (b.honorBands.length) tx.insert(ruleEnterHonorBands).values(b.honorBands).run();
    });
    this.settings.set('cooldownMode', b.cooldownMode);
    return this.base();
  }

  exclusives(): ExclusiveDto[] {
    return this.db
      .select()
      .from(ruleExclusive)
      .orderBy(ruleExclusive.createdAt)
      .all()
      .map((r) => {
        const v = this.viewers.cached(r.uid);
        return { ...toExclusive(r), name: v?.name ?? null, face: v?.face ?? null, guard: this.viewers.guardIn(r.uid), honor: v?.honor ?? 0, createdAt: r.createdAt };
      });
  }

  exclusive(uid: number): ExclusiveDto {
    const x = this.exclusives().find((e) => e.uid === uid);
    if (!x) throw new HttpError(404, 'not_found', '没有这个用户的专属规则');
    return x;
  }

  addExclusive(x: Exclusive): ExclusiveDto {
    if (this.db.select().from(ruleExclusive).where(eq(ruleExclusive.uid, x.uid)).get()) throw new HttpError(409, 'exists', `UID ${x.uid} 已经有专属规则了，可以直接修改`);
    this.checkEffects([x.effectId]);
    this.db.insert(ruleExclusive).values(x).run();
    return this.exclusive(x.uid);
  }

  updateExclusive(uid: number, patch: Partial<Omit<Exclusive, 'uid'>>): ExclusiveDto {
    this.exclusive(uid);
    if (patch.effectId !== undefined) this.checkEffects([patch.effectId]);
    this.db.update(ruleExclusive).set(patch).where(eq(ruleExclusive.uid, uid)).run();
    return this.exclusive(uid);
  }

  removeExclusive(uid: number): void {
    const r = this.db.delete(ruleExclusive).where(eq(ruleExclusive.uid, uid)).run();
    if (r.changes === 0) throw new HttpError(404, 'not_found', '没有这个用户的专属规则');
  }
}

function toExclusive(r: typeof ruleExclusive.$inferSelect): Exclusive {
  return { uid: r.uid, effectId: r.effectId, cooldownMin: r.cooldownMin, until: r.until, enabled: r.enabled };
}
