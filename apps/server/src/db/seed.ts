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
  { name: '霜·粉丝进场', style: 'frost', position: 'bl', durationMs: 3200, texts: { enter: ['{name} 来了'] } },
  { name: '字·一行', style: 'line', position: 'bl', durationMs: 2400, texts: { enter: ['{name} 进入直播间'], gift: ['{name} 送出 {gift} ×{count}'] } },
  // 普通观众：和粉丝牌进场同一个样子（霜玻），时间短一些；默认关闭
  { name: '霜·普通进场', style: 'frost', position: 'bl', durationMs: 2400, texts: { enter: ['{name} 来了'] } },
  // 大航海 · 东方宫廷：上面一行小字是欢迎语去掉昵称的部分，昵称单独写大字
  { name: '宫·总督', style: 'royal-gov', position: 'center', durationMs: 8000, texts: { enter: ['恭迎{guard} {name}'], gift: ['感谢送出 {gift} {name}'], guard: ['{guard}·{act} {name}'] } },
  { name: '宫·提督', style: 'royal-adm', position: 'center', durationMs: 6000, texts: { enter: ['恭迎{guard} {name}'], gift: ['感谢送出 {gift} {name}'], guard: ['{guard}·{act} {name}'] } },
  { name: '宫·舰长', style: 'royal-cap', position: 'center', durationMs: 4000, texts: { enter: ['恭迎{guard} {name}'], gift: ['感谢送出 {gift} {name}'], guard: ['{guard}·{act} {name}'] } },
  // 玻璃质感（大航海以外）：礼物 10 ~ 100 元、礼物 100 元以上、房管进场、弹幕回应。数量和礼物图由特效页单独显示，欢迎语里不用写
  { name: '晶·礼物', style: 'glass-gift', position: 'bl', durationMs: 4000, texts: { enter: ['{name} 来了'], gift: ['{name} 送出 {gift}'] } },
  { name: '晶·大礼物', style: 'glass-big', position: 'bl', durationMs: 6000, texts: { enter: ['{name} 来了'], gift: ['{name} 送出 {gift}'] } },
  // 礼物：有 B站全屏动画的播官方动画（时长跟动画走）；没有动画时按价值显示晶耀或晶礼，position、durationMs 是那时的位置和时长
  { name: 'B站·礼物动画', style: 'bili-gift', position: 'bl', durationMs: 5000, texts: { enter: ['{name} 来了'], gift: ['{name} 送出 {gift}'] } },
  { name: '晶·房管进场', style: 'glass-mod', position: 'bl', durationMs: 3200, texts: { enter: ['{name} 前来巡场'] } },
  { name: '晶·弹幕', style: 'glass-dm', position: 'top', durationMs: 3000, texts: { enter: ['{name}：{text}'], danmu: ['{name}：{text}'] } },
];

/**
 * 改过名的内置素材：旧名 → 新名（2026-10 统一成「系列·用途」）。升级时把内置素材改成新名字（规则按编号引用，不受影响）；
 * 以前导出的配置文件里的旧名字，导入时也按这里换成新名字
 */
export const RENAMED_EFFECTS: Record<string, string> = {
  霜玻: '霜·粉丝进场',
  '霜玻·简': '霜·普通进场',
  晶巡: '晶·房管进场',
  晶礼: '晶·礼物',
  晶耀: '晶·大礼物',
  晶语: '晶·弹幕',
  金銮: '宫·总督',
  亭阁: '宫·提督',
  门楼: '宫·舰长',
  一行字: '字·一行',
  B站动画: 'B站·礼物动画',
};

/**
 * 已经下线的内置素材 → 替代它的素材。升级时：规则里用到它的换成替代的，删掉它；
 * 以前复制出来的副本（不是内置的）保留，样式换成替代素材的样式
 */
export const RETIRED_EFFECTS: Array<{ name: string; style: string; replacedBy: string }> = [
  { name: '星冕', style: 'star', replacedBy: '晶·大礼物' },
  { name: '流星', style: 'meteor', replacedBy: '宫·提督' },
  { name: '流光', style: 'flow', replacedBy: '宫·舰长' },
  { name: '巡场', style: 'patrol', replacedBy: '晶·房管进场' },
  { name: '礼物感谢', style: 'gift', replacedBy: '晶·礼物' },
  { name: '弹幕回应', style: 'bubble', replacedBy: '晶·弹幕' },
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
  /** 主播本人不触发特效（F-PL-08）；默认关，主播自己发的也算 */
  blockAnchor: false,
  /** 用来连接直播间的账号不触发特效（F-PL-08，通常是小号）；默认关 */
  blockAccount: false,
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
    // 改名：内置素材换成新名字；新名字被自己建的素材占了时，那个素材改叫「新名字（我的）」
    for (const [from, to] of Object.entries(RENAMED_EFFECTS)) {
      const old = tx.select({ id: effects.id }).from(effects).where(and(eq(effects.name, from), eq(effects.builtin, true))).get();
      if (!old) continue;
      const taken = tx.select({ id: effects.id, builtin: effects.builtin }).from(effects).where(eq(effects.name, to)).get();
      if (taken?.builtin) continue;
      if (taken) tx.update(effects).set({ name: `${to}（我的）` }).where(eq(effects.id, taken.id)).run();
      tx.update(effects).set({ name: to }).where(eq(effects.id, old.id)).run();
    }
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
      { tier: 'gov', effectId: id('宫·总督'), cooldownMin: 5, enabled: true },
      { tier: 'adm', effectId: id('宫·提督'), cooldownMin: 5, enabled: true },
      { tier: 'cap', effectId: id('宫·舰长'), cooldownMin: 5, enabled: true },
      { tier: 'mod', effectId: id('晶·房管进场'), cooldownMin: 10, enabled: true },
      { tier: 'nor', effectId: id('霜·普通进场'), cooldownMin: 30, enabled: false },
    ] as const;
    for (const t of tiers) tx.insert(ruleEnterTiers).values(t).onConflictDoNothing().run();
    if (!tx.select().from(ruleEnterBands).limit(1).get()) {
      tx.insert(ruleEnterBands).values([
        { fromLevel: 21, effectId: id('霜·粉丝进场'), cooldownMin: 10, enabled: true },
        { fromLevel: 1, effectId: id('霜·粉丝进场'), cooldownMin: 15, enabled: true },
      ]).run();
    }
    // 礼物：≥ 10 元播 B站动画（没有动画的礼物按价值显示晶耀、晶礼）、1 ~ 10 元一行字（默认关闭）；低于 1 元不播
    if (!tx.select().from(ruleGiftBands).limit(1).get()) {
      tx.insert(ruleGiftBands).values([
        { fromGold: 100_000, effectId: id('B站·礼物动画'), enabled: true },
        { fromGold: 10_000, effectId: id('B站·礼物动画'), enabled: true },
        { fromGold: 1000, effectId: id('字·一行'), enabled: false },
      ]).run();
    }
    const guards = [
      { tier: 'gov', openEffectId: id('宫·总督'), renewEffectId: id('宫·总督'), enabled: true },
      { tier: 'adm', openEffectId: id('宫·提督'), renewEffectId: id('宫·提督'), enabled: true },
      { tier: 'cap', openEffectId: id('宫·舰长'), renewEffectId: id('宫·舰长'), enabled: true },
    ] as const;
    for (const g of guards) tx.insert(ruleGuard).values(g).onConflictDoNothing().run();
    if (!tx.select().from(outputs).limit(1).get()) {
      tx.insert(outputs).values({ name: '竖屏直播', key: crypto.randomBytes(16).toString('base64url') }).run();
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) tx.insert(settings).values({ key, value }).onConflictDoNothing().run();
  });
}
