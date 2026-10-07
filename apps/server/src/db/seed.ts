// 首次启动时写入的初始数据（需求文档附录 B）。可以重复执行：已有的数据不会被覆盖。
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { EffectTexts, Position } from '@starfall/shared';
import type { Db } from './index.ts';
import { effects, outputs, ruleDanmu, ruleEnterBands, ruleEnterHonorBands, ruleEnterTiers, ruleExclusive, ruleGiftBands, ruleGiftSpecific, ruleGuard, settings } from './schema.ts';

interface BuiltinEffect {
  name: string;
  style: string;
  texts: EffectTexts;
  position: Position;
  durationMs: number;
}

/** 内置素材（界面与设计预览一致；样式由特效页实现，这里只存名称和参数） */
export const BUILTIN_EFFECTS: BuiltinEffect[] = [
  { name: '霜玻', style: 'frost', position: 'bl', durationMs: 3200, texts: { enter: ['{name} 来了'] } },
  { name: '一行字', style: 'line', position: 'bl', durationMs: 2400, texts: { enter: ['{name} 进入直播间'], gift: ['{name} 送出 {gift} ×{count}'] } },
  // 普通观众：和粉丝牌进场同一个样子（霜玻），时间短一些；默认关闭
  { name: '霜玻·简', style: 'frost', position: 'bl', durationMs: 2400, texts: { enter: ['{name} 来了'] } },
  // 大航海 · 东方宫廷：上面一行小字是欢迎语去掉昵称的部分，昵称单独写大字
  { name: '金銮', style: 'royal-gov', position: 'center', durationMs: 8000, texts: { enter: ['恭迎{guard} {name}'], gift: ['感谢送出 {gift} {name}'], guard: ['{guard}·{act} {name}'] } },
  { name: '亭阁', style: 'royal-adm', position: 'center', durationMs: 6000, texts: { enter: ['恭迎{guard} {name}'], gift: ['感谢送出 {gift} {name}'], guard: ['{guard}·{act} {name}'] } },
  { name: '门楼', style: 'royal-cap', position: 'center', durationMs: 4000, texts: { enter: ['恭迎{guard} {name}'], gift: ['感谢送出 {gift} {name}'], guard: ['{guard}·{act} {name}'] } },
  // 玻璃质感（大航海以外）：礼物 10 ~ 100 元、礼物 100 元以上、房管进场、弹幕回应。数量和礼物图由特效页单独显示，欢迎语里不用写
  { name: '晶礼', style: 'glass-gift', position: 'bl', durationMs: 4000, texts: { enter: ['{name} 来了'], gift: ['{name} 送出 {gift}'] } },
  { name: '晶耀', style: 'glass-big', position: 'bl', durationMs: 6000, texts: { enter: ['{name} 来了'], gift: ['{name} 送出 {gift}'] } },
  // 礼物：有 B站全屏动画的播官方动画（时长跟动画走）；没有动画时按价值显示晶耀或晶礼，position、durationMs 是那时的位置和时长
  { name: 'B站动画', style: 'bili-gift', position: 'bl', durationMs: 5000, texts: { enter: ['{name} 来了'], gift: ['{name} 送出 {gift}'] } },
  { name: '晶巡', style: 'glass-mod', position: 'bl', durationMs: 3200, texts: { enter: ['{name} 前来巡场'] } },
  { name: '晶语', style: 'glass-dm', position: 'top', durationMs: 3000, texts: { enter: ['{name}：{text}'], danmu: ['{name}：{text}'] } },
];

/**
 * 已经下线的内置素材 → 替代它的素材。升级时：规则里用到它的换成替代的，删掉它；
 * 以前复制出来的副本（不是内置的）保留，样式换成替代素材的样式
 */
export const RETIRED_EFFECTS: Array<{ name: string; style: string; replacedBy: string }> = [
  { name: '星冕', style: 'star', replacedBy: '晶耀' },
  { name: '流星', style: 'meteor', replacedBy: '亭阁' },
  { name: '流光', style: 'flow', replacedBy: '门楼' },
  { name: '巡场', style: 'patrol', replacedBy: '晶巡' },
  { name: '礼物感谢', style: 'gift', replacedBy: '晶礼' },
  { name: '弹幕回应', style: 'bubble', replacedBy: '晶语' },
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
  /** 礼物特效里的礼物图用动图（B站的动态礼物图）；关掉用静态图 */
  giftAnimImg: true,
  /** 主播本人不触发特效（F-PL-08） */
  blockAnchor: true,
  /** 用来连接直播间的账号不触发特效（F-PL-08，通常是小号） */
  blockAccount: true,
  /** 事件记录保留天数，0 为永久（F-DA-02） */
  retentionDays: 90,
  /** 礼物连击合并（F-GF-04） */
  giftComboEnabled: true,
  giftComboSec: 3,
  /** 每天自动备份数据库和配置（F-DA-03） */
  autoBackup: true,
  /** 素材上下羽化（全局）：只对没有透明通道的素材生效，素材里可以单独设置 */
  featherOn: false,
  featherPct: 10,
  /** 新手引导已完成或跳过（F-UI-06） */
  onboarded: false,
  /** 直播软件里的特效页连上过（首页「开始使用」的第 3 步按这个算，不按此刻在不在线） */
  overlaySeen: false,
};
export type Settings = typeof DEFAULT_SETTINGS;

export function seed(db: Db): void {
  db.transaction((tx) => {
    for (const e of BUILTIN_EFFECTS) {
      tx.insert(effects).values({ name: e.name, builtin: true, style: e.style, texts: e.texts, position: e.position, durationMs: e.durationMs, showText: true }).onConflictDoNothing().run();
      // 内置素材在后台是只读的：升级后同步成新版本的文案（用户要改只能复制一份）
      tx.update(effects).set({ texts: e.texts }).where(and(eq(effects.name, e.name), eq(effects.builtin, true))).run();
    }
    const id = (name: string) => tx.select({ id: effects.id }).from(effects).where(eq(effects.name, name)).get()!.id;
    // 下线的内置素材：规则换成替代素材后删除；副本换成替代素材的样式
    for (const r of RETIRED_EFFECTS) {
      const to = id(r.replacedBy);
      const toStyle = BUILTIN_EFFECTS.find((e) => e.name === r.replacedBy)!.style;
      tx.update(effects).set({ style: toStyle }).where(and(eq(effects.style, r.style), eq(effects.builtin, false))).run();
      const old = tx.select({ id: effects.id }).from(effects).where(and(eq(effects.name, r.name), eq(effects.builtin, true))).get();
      if (!old) continue;
      for (const [table, col] of [[ruleEnterTiers, ruleEnterTiers.effectId], [ruleEnterBands, ruleEnterBands.effectId], [ruleEnterHonorBands, ruleEnterHonorBands.effectId], [ruleExclusive, ruleExclusive.effectId], [ruleDanmu, ruleDanmu.effectId], [ruleGiftBands, ruleGiftBands.effectId], [ruleGiftSpecific, ruleGiftSpecific.effectId]] as const) {
        tx.update(table).set({ effectId: to }).where(eq(col, old.id)).run();
      }
      tx.update(ruleGuard).set({ openEffectId: to }).where(eq(ruleGuard.openEffectId, old.id)).run();
      tx.update(ruleGuard).set({ renewEffectId: to }).where(eq(ruleGuard.renewEffectId, old.id)).run();
      tx.delete(effects).where(eq(effects.id, old.id)).run();
    }
    const tiers = [
      { tier: 'gov', effectId: id('金銮'), cooldownMin: 5, enabled: true },
      { tier: 'adm', effectId: id('亭阁'), cooldownMin: 5, enabled: true },
      { tier: 'cap', effectId: id('门楼'), cooldownMin: 5, enabled: true },
      { tier: 'mod', effectId: id('晶巡'), cooldownMin: 10, enabled: true },
      { tier: 'nor', effectId: id('霜玻·简'), cooldownMin: 30, enabled: false },
    ] as const;
    for (const t of tiers) tx.insert(ruleEnterTiers).values(t).onConflictDoNothing().run();
    if (!tx.select().from(ruleEnterBands).limit(1).get()) {
      tx.insert(ruleEnterBands).values([
        { fromLevel: 21, effectId: id('霜玻'), cooldownMin: 10, enabled: true },
        { fromLevel: 1, effectId: id('霜玻'), cooldownMin: 15, enabled: true },
      ]).run();
    }
    // 礼物：≥ 10 元播 B站动画（没有动画的礼物按价值显示晶耀、晶礼）、1 ~ 10 元一行字（默认关闭）；低于 1 元不播
    if (!tx.select().from(ruleGiftBands).limit(1).get()) {
      tx.insert(ruleGiftBands).values([
        { fromGold: 100_000, effectId: id('B站动画'), enabled: true },
        { fromGold: 10_000, effectId: id('B站动画'), enabled: true },
        { fromGold: 1000, effectId: id('一行字'), enabled: false },
      ]).run();
    }
    const guards = [
      { tier: 'gov', openEffectId: id('金銮'), renewEffectId: id('金銮'), enabled: true },
      { tier: 'adm', openEffectId: id('亭阁'), renewEffectId: id('亭阁'), enabled: true },
      { tier: 'cap', openEffectId: id('门楼'), renewEffectId: id('门楼'), enabled: true },
    ] as const;
    for (const g of guards) tx.insert(ruleGuard).values(g).onConflictDoNothing().run();
    if (!tx.select().from(outputs).limit(1).get()) {
      tx.insert(outputs).values({ name: '竖屏直播', key: crypto.randomBytes(16).toString('base64url') }).run();
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) tx.insert(settings).values({ key, value }).onConflictDoNothing().run();
  });
}
