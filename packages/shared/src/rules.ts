// 素材与规则的数据格式。用 Zod 定义，既做接口校验，也生成 TypeScript 类型，前后端共用。
import { z } from 'zod';

export * from './labels.ts';

// ---------- 素材 ----------

export const POSITIONS = ['bl', 'br', 'top', 'center'] as const;
export type Position = (typeof POSITIONS)[number];

/** 欢迎语按事件分开写；没写的事件使用 enter（通用） */
export const EffectTextsSchema = z.object({
  enter: z.array(z.string().max(100)).max(20),
  danmu: z.array(z.string().max(100)).max(20).optional(),
  gift: z.array(z.string().max(100)).max(20).optional(),
  guard: z.array(z.string().max(100)).max(20).optional(),
});
export type EffectTexts = z.infer<typeof EffectTextsSchema>;

export const EffectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(40),
  builtin: z.boolean(),
  visual: z.discriminatedUnion('type', [
    z.object({ type: z.literal('builtin_style'), style: z.string().min(1) }),
    z.object({ type: z.literal('asset'), assetId: z.number().int().positive() }),
  ]),
  /** 是否在画面上叠加头像和欢迎语（上传的素材默认不叠加） */
  showText: z.boolean(),
  texts: EffectTextsSchema,
  soundAssetId: z.number().int().positive().nullable(),
  volume: z.number().int().min(0).max(100),
  position: z.enum(POSITIONS),
  durationMs: z.number().int().min(500).max(30_000),
});
export type Effect = z.infer<typeof EffectSchema>;

// ---------- 进场规则 ----------

const cooldownMin = z.number().int().min(0).max(1440);

export const TierRuleSchema = z.object({
  effectId: z.number().int().positive().nullable(),
  cooldownMin,
  enabled: z.boolean(),
});
export type TierRule = z.infer<typeof TierRuleSchema>;


/** 粉丝牌分档：只存起始等级，区间由相邻两档推出，所以不会重叠 */
export const MedalBandSchema = z.object({
  fromLevel: z.number().int().min(1).max(60),
  effectId: z.number().int().positive().nullable(),
  cooldownMin,
  enabled: z.boolean(),
});
export type MedalBand = z.infer<typeof MedalBandSchema>;

export const ExclusiveSchema = z.object({
  uid: z.number().int().positive(),
  effectId: z.number().int().positive(),
  cooldownMin,
  /** 有效期截止日（含当天），格式 YYYY-MM-DD；不填为长期 */
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  enabled: z.boolean(),
});
export type Exclusive = z.infer<typeof ExclusiveSchema>;

export const EnterRulesSchema = z
  .object({
    tiers: z.object({ gov: TierRuleSchema, adm: TierRuleSchema, cap: TierRuleSchema, mod: TierRuleSchema, nor: TierRuleSchema }),
    bands: z.array(MedalBandSchema).min(1).max(20),
    exclusives: z.array(ExclusiveSchema).max(2000),
    /** 冷却方式：按分钟，或每场直播每人只播一次 */
    cooldownMode: z.enum(['minutes', 'oncePerLive']),
  })
  .superRefine((r, ctx) => {
    const levels = r.bands.map((b) => b.fromLevel);
    if (new Set(levels).size !== levels.length) ctx.addIssue({ code: 'custom', path: ['bands'], message: '粉丝牌分档的起始等级不能重复' });
    const uids = r.exclusives.map((x) => x.uid);
    if (new Set(uids).size !== uids.length) ctx.addIssue({ code: 'custom', path: ['exclusives'], message: '同一个 UID 只能设一条专属规则' });
  });
export type EnterRules = z.infer<typeof EnterRulesSchema>;

// ---------- 弹幕规则（需求 F-DM-01 ~ 04） ----------

/** 发送人条件 */
export const DANMU_WHO = ['all', 'fan', 'fan10', 'guard', 'mod'] as const;
export type DanmuWho = (typeof DANMU_WHO)[number];

export const DanmuRuleSchema = z.object({
  id: z.number().int().positive(),
  keywords: z.array(z.string().trim().min(1).max(30)).min(1).max(20),
  /** 包含 / 完全一致 */
  mode: z.enum(['contains', 'exact']),
  who: z.enum(DANMU_WHO),
  effectId: z.number().int().positive().nullable(),
  /** 全局冷却（秒）：这条规则播放后，任何人再触发都要等 */
  globalCdSec: z.number().int().min(0).max(3600),
  /** 每人冷却（分钟） */
  userCdMin: z.number().int().min(0).max(1440),
  enabled: z.boolean(),
});
export type DanmuRule = z.infer<typeof DanmuRuleSchema>;

// ---------- 礼物规则（需求 F-GF-01 ~ 05） ----------

export const GiftSpecificSchema = z.object({
  giftId: z.number().int().positive(),
  giftName: z.string().max(40),
  effectId: z.number().int().positive().nullable(),
  enabled: z.boolean(),
});
export type GiftSpecific = z.infer<typeof GiftSpecificSchema>;

/** 按单次价值分档：只存起始价值（金瓜子），区间由相邻两档推出 */
export const GiftBandSchema = z.object({
  fromGold: z.number().int().min(1).max(100_000_000),
  effectId: z.number().int().positive().nullable(),
  enabled: z.boolean(),
});
export type GiftBand = z.infer<typeof GiftBandSchema>;

export const GiftRulesSchema = z
  .object({
    specific: z.array(GiftSpecificSchema).max(200),
    bands: z.array(GiftBandSchema).min(1).max(20),
    /** 连击合并：同一人在 comboSec 秒内连续送同一种礼物，合并为一次 */
    comboEnabled: z.boolean(),
    comboSec: z.number().int().min(1).max(15),
  })
  .superRefine((r, ctx) => {
    const ids = r.specific.map((x) => x.giftId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['specific'], message: '同一种礼物只能设一条规则' });
    const golds = r.bands.map((b) => b.fromGold);
    if (new Set(golds).size !== golds.length) ctx.addIssue({ code: 'custom', path: ['bands'], message: '礼物分档的起始价值不能重复' });
  });
export type GiftRules = z.infer<typeof GiftRulesSchema>;

// ---------- 上舰规则（需求 F-GD-01 ~ 02） ----------

export const GuardRuleSchema = z.object({
  openEffectId: z.number().int().positive().nullable(),
  renewEffectId: z.number().int().positive().nullable(),
  enabled: z.boolean(),
});
export type GuardRule = z.infer<typeof GuardRuleSchema>;

export const GuardRulesSchema = z.object({ gov: GuardRuleSchema, adm: GuardRuleSchema, cap: GuardRuleSchema });
export type GuardRules = z.infer<typeof GuardRulesSchema>;

