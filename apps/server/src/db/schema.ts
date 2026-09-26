// 数据库表结构（方案设计第 6 节）。时间一律存毫秒时间戳；金额存金瓜子（整数）。
// 修改后运行 pnpm --filter @starfall/server db:generate 生成迁移文件。
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { EffectTexts, Position, Tier } from '@starfall/shared';

const now = sql`(unixepoch() * 1000)`;
const bool = (name: string) => integer(name, { mode: 'boolean' });

/** 键值配置：暂停状态、未开播策略、冷却方式、队列设置等 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/** B 站登录账号（只有一行）。Cookie 和 refresh_token 加密存储 */
export const account = sqliteTable('account', {
  id: integer('id').primaryKey(),
  uid: integer('uid').notNull(),
  name: text('name').notNull().default(''),
  face: text('face').notNull().default(''),
  cookiesEnc: text('cookies_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull().default(''),
  expiresAt: integer('expires_at'),
  updatedAt: integer('updated_at').notNull().default(now),
});

/** 直播间（只有一行） */
export const room = sqliteTable('room', {
  id: integer('id').primaryKey(),
  roomId: integer('room_id').notNull(),
  shortId: integer('short_id').notNull().default(0),
  anchorUid: integer('anchor_uid').notNull(),
  anchorName: text('anchor_name').notNull().default(''),
  updatedAt: integer('updated_at').notNull().default(now),
});

/** 上传的文件，按内容哈希存储，相同文件只存一份 */
export const assets = sqliteTable('assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['video', 'image', 'fx', 'audio'] }).notNull(),
  filename: text('filename').notNull(),
  sha256: text('sha256').notNull().unique(),
  ext: text('ext').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  hasAlpha: bool('has_alpha').notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

/** 素材（可播放的特效）。被规则引用时不能删除（外键 RESTRICT） */
export const effects = sqliteTable('effects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  builtin: bool('builtin').notNull().default(false),
  style: text('style'),
  assetId: integer('asset_id').references(() => assets.id, { onDelete: 'restrict' }),
  showText: bool('show_text').notNull().default(true),
  texts: text('texts', { mode: 'json' }).$type<EffectTexts>().notNull(),
  soundAssetId: integer('sound_asset_id').references(() => assets.id, { onDelete: 'restrict' }),
  volume: integer('volume').notNull().default(70),
  position: text('position').$type<Position>().notNull().default('center'),
  durationMs: integer('duration_ms').notNull().default(5000),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

/** 进场身份档位（固定 5 行） */
export const ruleEnterTiers = sqliteTable('rule_enter_tiers', {
  tier: text('tier').$type<Tier>().primaryKey(),
  effectId: integer('effect_id').references(() => effects.id, { onDelete: 'restrict' }),
  cooldownMin: integer('cooldown_min').notNull(),
  enabled: bool('enabled').notNull(),
});

/** 进场粉丝牌分档：只存起始等级 */
export const ruleEnterBands = sqliteTable('rule_enter_bands', {
  fromLevel: integer('from_level').primaryKey(),
  effectId: integer('effect_id').references(() => effects.id, { onDelete: 'restrict' }),
  cooldownMin: integer('cooldown_min').notNull(),
  enabled: bool('enabled').notNull(),
});

/** 专属用户（只对进场生效） */
export const ruleExclusive = sqliteTable('rule_exclusive', {
  uid: integer('uid').primaryKey(),
  effectId: integer('effect_id')
    .notNull()
    .references(() => effects.id, { onDelete: 'restrict' }),
  cooldownMin: integer('cooldown_min').notNull(),
  until: text('until'),
  enabled: bool('enabled').notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

/** 弹幕规则（按 sort 从小到大匹配） */
export const ruleDanmu = sqliteTable('rule_danmu', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sort: integer('sort').notNull(),
  keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull(),
  mode: text('mode', { enum: ['contains', 'exact'] }).notNull(),
  who: text('who', { enum: ['all', 'fan', 'fan10', 'guard', 'mod'] }).notNull(),
  effectId: integer('effect_id').references(() => effects.id, { onDelete: 'restrict' }),
  globalCdSec: integer('global_cd_sec').notNull(),
  userCdMin: integer('user_cd_min').notNull(),
  enabled: bool('enabled').notNull(),
});

/** 指定礼物（按礼物 ID） */
export const ruleGiftSpecific = sqliteTable('rule_gift_specific', {
  giftId: integer('gift_id').primaryKey(),
  giftName: text('gift_name').notNull().default(''),
  effectId: integer('effect_id').references(() => effects.id, { onDelete: 'restrict' }),
  enabled: bool('enabled').notNull(),
  sort: integer('sort').notNull().default(0),
});

/** 礼物按单次价值分档：只存起始价值（金瓜子） */
export const ruleGiftBands = sqliteTable('rule_gift_bands', {
  fromGold: integer('from_gold').primaryKey(),
  effectId: integer('effect_id').references(() => effects.id, { onDelete: 'restrict' }),
  enabled: bool('enabled').notNull(),
});

/** 上舰（固定 3 行：gov / adm / cap） */
export const ruleGuard = sqliteTable('rule_guard', {
  tier: text('tier', { enum: ['gov', 'adm', 'cap'] }).primaryKey(),
  openEffectId: integer('open_effect_id').references(() => effects.id, { onDelete: 'restrict' }),
  renewEffectId: integer('renew_effect_id').references(() => effects.id, { onDelete: 'restrict' }),
  enabled: bool('enabled').notNull(),
});

export const blacklist = sqliteTable('blacklist', {
  uid: integer('uid').primaryKey(),
  name: text('name').notNull().default(''),
  note: text('note').notNull().default(''),
  createdAt: integer('created_at').notNull().default(now),
});

/** 输出：一个特效页地址 + 一套画布设置 */
export const outputs = sqliteTable('outputs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  app: text('app', { enum: ['livehime', 'obs'] }).notNull().default('livehime'),
  orient: text('orient', { enum: ['portrait', 'landscape'] }).notNull().default('portrait'),
  width: integer('width').notNull().default(1080),
  height: integer('height').notNull().default(1920),
  safeTop: integer('safe_top').notNull().default(12),
  safeBottom: integer('safe_bottom').notNull().default(40),
  marginX: integer('margin_x').notNull().default(9),
  scale: integer('scale').notNull().default(100),
  liteMode: text('lite_mode', { enum: ['auto', 'on', 'off'] }).notNull().default('auto'),
  key: text('key').notNull().unique(),
  createdAt: integer('created_at').notNull().default(now),
});

export const liveSessions = sqliteTable('live_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
});

/** 事件记录：每个事件一行，带判断结果和原因 */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    sessionId: integer('session_id'),
    kind: text('kind', { enum: ['enter', 'danmu', 'gift', 'guard'] }).notNull(),
    uid: integer('uid').notNull(),
    uname: text('uname').notNull(),
    viewer: text('viewer', { mode: 'json' }).notNull(),
    payload: text('payload', { mode: 'json' }),
    rule: text('rule'),
    effectId: integer('effect_id'),
    status: text('status').notNull(),
    raw: text('raw', { mode: 'json' }),
  },
  (t) => [index('events_ts').on(t.ts), index('events_uid_ts').on(t.uid, t.ts), index('events_kind_ts').on(t.kind, t.ts), index('events_session').on(t.sessionId)],
);

/** 观众缓存：昵称、头像（专属用户、黑名单显示用） */
export const viewers = sqliteTable('viewers', {
  uid: integer('uid').primaryKey(),
  name: text('name').notNull(),
  face: text('face').notNull().default(''),
  updatedAt: integer('updated_at').notNull().default(now),
});
