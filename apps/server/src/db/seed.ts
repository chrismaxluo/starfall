// 首次启动时写入的初始数据（需求文档附录 B）。可以重复执行：已有的数据不会被覆盖。
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { EffectTexts, Position } from '@starfall/shared';
import type { Db } from './index.ts';
import { effects, outputs, ruleEnterBands, ruleEnterTiers, settings } from './schema.ts';

interface BuiltinEffect {
  name: string;
  style: string;
  texts: EffectTexts;
  position: Position;
  durationMs: number;
}

/** 内置素材（界面与设计预览一致；样式由特效页实现，这里只存名称和参数） */
export const BUILTIN_EFFECTS: BuiltinEffect[] = [
  { name: '星冕', style: 'star', position: 'center', durationMs: 6800, texts: { enter: ['{guard} {name} 驾临'], gift: ['感谢 {name} 送出 {gift}，星光加冕'], guard: ['{name} 开通{guard}，驾临'] } },
  { name: '流星', style: 'meteor', position: 'bl', durationMs: 5200, texts: { enter: ['欢迎{guard} {name} 登船'], gift: ['感谢 {name} 送出 {gift}'], guard: ['欢迎新{guard} {name} 登船'] } },
  { name: '流光', style: 'flow', position: 'bl', durationMs: 4200, texts: { enter: ['欢迎{guard} {name} 登船'], guard: ['欢迎新{guard} {name} 登船'], danmu: ['{name}：{text}'] } },
  { name: '巡场', style: 'patrol', position: 'bl', durationMs: 3600, texts: { enter: ['{name} 前来巡场'] } },
  { name: '霜玻', style: 'frost', position: 'bl', durationMs: 3200, texts: { enter: ['{name} 来了'] } },
  { name: '礼物感谢', style: 'gift', position: 'bl', durationMs: 4000, texts: { enter: ['感谢 {name} 送出 {gift} ×{count}'], guard: ['感谢 {name} 续费{guard} {months} 个月'] } },
  { name: '弹幕回应', style: 'bubble', position: 'top', durationMs: 3000, texts: { enter: ['{name}：{text}'] } },
  { name: '一行字', style: 'line', position: 'bl', durationMs: 2400, texts: { enter: ['{name} 进入直播间'], gift: ['{name} 送出 {gift} ×{count}'] } },
];

/** 默认设置 */
export const DEFAULT_SETTINGS = {
  /** 紧急暂停 */
  paused: false,
  /** 连接时机：只在开播时连接（F-BL-10），或始终连接 */
  connectMode: 'live_only' as 'live_only' | 'always',
  /** 未开播时：不播放，或照常播放（排练） */
  offlinePolicy: 'mute' as 'mute' | 'play',
  /** 进场冷却方式 */
  cooldownMode: 'minutes' as 'minutes' | 'oncePerLive',
  queueMax: 10,
  queueJump: true,
};
export type Settings = typeof DEFAULT_SETTINGS;

export function seed(db: Db): void {
  db.transaction((tx) => {
    for (const e of BUILTIN_EFFECTS) {
      tx.insert(effects).values({ name: e.name, builtin: true, style: e.style, texts: e.texts, position: e.position, durationMs: e.durationMs, showText: true }).onConflictDoNothing().run();
    }
    const id = (name: string) => tx.select({ id: effects.id }).from(effects).where(eq(effects.name, name)).get()!.id;
    const tiers = [
      { tier: 'gov', effectId: id('星冕'), cooldownMin: 5, enabled: true },
      { tier: 'adm', effectId: id('流星'), cooldownMin: 5, enabled: true },
      { tier: 'cap', effectId: id('流光'), cooldownMin: 5, enabled: true },
      { tier: 'mod', effectId: id('巡场'), cooldownMin: 10, enabled: true },
      { tier: 'nor', effectId: id('一行字'), cooldownMin: 30, enabled: false },
    ] as const;
    for (const t of tiers) tx.insert(ruleEnterTiers).values(t).onConflictDoNothing().run();
    if (!tx.select().from(ruleEnterBands).limit(1).get()) {
      tx.insert(ruleEnterBands).values([
        { fromLevel: 21, effectId: id('霜玻'), cooldownMin: 10, enabled: true },
        { fromLevel: 1, effectId: id('霜玻'), cooldownMin: 15, enabled: true },
      ]).run();
    }
    if (!tx.select().from(outputs).limit(1).get()) {
      tx.insert(outputs).values({ name: '竖屏直播', key: crypto.randomBytes(16).toString('base64url') }).run();
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) tx.insert(settings).values({ key, value }).onConflictDoNothing().run();
  });
}
