// 素材与规则的数据格式。用 Zod 定义，既做接口校验，也生成 TypeScript 类型，前后端共用。
import { z } from 'zod';

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

/** 固定的身份档位 */
export const TIERS = ['gov', 'adm', 'cap', 'mod', 'nor'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_NAMES: Record<Tier, string> = { gov: '总督', adm: '提督', cap: '舰长', mod: '房管', nor: '普通观众' };

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

// ---------- 播放状态 ----------

/** 事件最终的处理结果，写入事件记录 */
export const PLAY_STATUS = {
  played: '已播放',
  queued: '排队中',
  no_rule: '未命中规则',
  blacklist: '黑名单',
  paused: '已暂停',
  offline: '未开播',
  cooldown: '冷却中',
  once: '本场已播过',
  no_overlay: '特效页不在线',
  dropped: '队列已满，丢弃',
  duplicate: '重复消息',
} as const;
export type PlayStatus = keyof typeof PLAY_STATUS;
