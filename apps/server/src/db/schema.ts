// 数据库表结构（方案设计第 6 节）。时间一律存毫秒时间戳；金额存金瓜子（整数）。
// 修改后运行 pnpm --filter @starfall/server db:generate 生成迁移文件。
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { DanmuWho, EffectTexts, FeatherMode, GiftListItem, GiftsFilter, MusicSource, Position, SvgaRole, Tier } from '@starfall/shared';
import type { SvgaSlot } from '../services/probe.ts';

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
  /** SVGA 里可以替换的图层（其他类型为 null） */
  slots: text('slots', { mode: 'json' }).$type<SvgaSlot[]>(),
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
  /** 有时长的素材手动设置时长（关着时跟随素材） */
  durationCustom: bool('duration_custom').notNull().default(false),
  /** 上传的素材开头淡入、结尾淡出（升级前的素材保持开启，新上传的默认关闭） */
  fadeIn: bool('fade_in').notNull().default(true),
  fadeOut: bool('fade_out').notNull().default(true),
  fadeInMs: integer('fade_in_ms').notNull().default(500),
  fadeOutMs: integer('fade_out_ms').notNull().default(500),
  /** 在位置的基础上挪动：画面宽、高的百分比 */
  offsetX: real('offset_x').notNull().default(0),
  offsetY: real('offset_y').notNull().default(0),
  /** 大小：程序自动算出的大小的百分比 */
  sizePct: integer('size_pct').notNull().default(100),
  /** 上下羽化：跟随全局 / 自己设置 / 不羽化 */
  feather: text('feather').$type<FeatherMode>().notNull().default('global'),
  featherPct: integer('feather_pct').notNull().default(10),
  /** 头像和欢迎语里，大航海观众的头像套上 B 站头像框 */
  guardFrame: bool('guard_frame').notNull().default(false),
  honorBadge: bool('honor_badge').notNull().default(false),
  /** SVGA：图层名 → 播放时换成什么 */
  svgaMap: text('svga_map', { mode: 'json' }).$type<Record<string, SvgaRole>>().notNull().default({}),
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

/** 进场荣耀等级分档：只存起始等级（低于最低一档的不算） */
export const ruleEnterHonorBands = sqliteTable('rule_enter_honor_bands', {
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
  /** 谁发的弹幕才算（多选，JSON）；以前是单选的字符串，升级时换成多选 */
  who: text('who', { mode: 'json' }).$type<DanmuWho>().notNull(),
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
  // 弹幕列表（同一个输出的另一个浏览器源）
  chatEnabled: integer('chat_enabled', { mode: 'boolean' }).notNull().default(true),
  chatSide: text('chat_side', { enum: ['left', 'right'] }).notNull().default('left'),
  chatSize: text('chat_size', { enum: ['normal', 'large'] }).notNull().default('normal'),
  chatMedal: text('chat_medal', { enum: ['own', 'all'] }).notNull().default('own'),
  chatMax: integer('chat_max').notNull().default(8),
  chatFadeSec: integer('chat_fade_sec').notNull().default(0),
  // 送礼名单（同一个输出的又一个浏览器源）；默认靠右，和靠左的弹幕列表错开
  giftsEnabled: integer('gifts_enabled', { mode: 'boolean' }).notNull().default(true),
  giftsSide: text('gifts_side', { enum: ['left', 'right'] }).notNull().default('right'),
  giftsSize: text('gifts_size', { enum: ['normal', 'large'] }).notNull().default('normal'),
  giftsMax: integer('gifts_max').notNull().default(6),
  giftsSpeed: text('gifts_speed', { enum: ['off', 'slow', 'normal', 'fast'] }).notNull().default('normal'),
  giftsFilter: text('gifts_filter', { mode: 'json' }).$type<GiftsFilter>().notNull().default({ mode: 'all', gifts: [], guard: true, sc: true }),
  key: text('key').notNull().unique(),
  createdAt: integer('created_at').notNull().default(now),
});

/** 送礼名单挂上的记录：存一份当时的样子（事件记录过期删掉了也不影响），event_id 防止同一条挂两次 */
export const giftPins = sqliteTable('gift_pins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().unique(),
  item: text('item', { mode: 'json' }).$type<GiftListItem>().notNull(),
  sort: integer('sort').notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

export const liveSessions = sqliteTable('live_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** 哪个直播间的直播（换直播间后数据分开算） */
  roomId: integer('room_id'),
  /** 开播时间：B 站记录的开播时间（拿不到时用发现开播的时间） */
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
});

/** 事件记录：每个事件一行，带判断结果和原因 */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    /** 哪个直播间的事件（换直播间后数据分开算） */
    roomId: integer('room_id'),
    sessionId: integer('session_id'),
    kind: text('kind', { enum: ['enter', 'danmu', 'gift', 'guard', 'sc'] }).notNull(),
    uid: integer('uid').notNull(),
    uname: text('uname').notNull(),
    viewer: text('viewer', { mode: 'json' }).notNull(),
    payload: text('payload', { mode: 'json' }),
    rule: text('rule'),
    effectId: integer('effect_id'),
    status: text('status').notNull(),
    raw: text('raw', { mode: 'json' }),
  },
  (t) => [index('events_ts').on(t.ts), index('events_uid_ts').on(t.uid, t.ts), index('events_kind_ts').on(t.kind, t.ts), index('events_session').on(t.sessionId), index('events_room_ts').on(t.roomId, t.ts), index('events_room_id').on(t.roomId, t.id), index('events_room_kind_id').on(t.roomId, t.kind, t.id)],
);

/** 素材快捷播放的按钮（按 sort 排列）。素材删除时按钮一起删掉 */
export const quickPlay = sqliteTable('quick_play', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sort: integer('sort').notNull(),
  effectId: integer('effect_id')
    .notNull()
    .references(() => effects.id, { onDelete: 'cascade' }),
  /** 按钮上显示的名字（空的时候显示素材名） */
  label: text('label').notNull().default(''),
  /** 后台页面里的快捷键（单个数字或字母） */
  hotkey: text('hotkey'),
  /** 桌面版的全局快捷键，例如 Ctrl+Alt+1 */
  globalHotkey: text('global_hotkey'),
});

/** 观众缓存：昵称、头像（专属用户、黑名单显示用） */
export const viewers = sqliteTable('viewers', {
  uid: integer('uid').primaryKey(),
  name: text('name').notNull(),
  face: text('face').notNull().default(''),
  /** 最近一次在哪个直播间看到 TA 是大航海几级（0 不是）：只在同一个直播间里算数 */
  guard: integer('guard').notNull().default(0),
  guardRoom: integer('guard_room'),
  /** 最近一次看到的荣耀等级（0 不知道） */
  honor: integer('honor').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(now),
});

/**
 * 点歌记录：列表里的歌（queued、playing）和放过的（历史）。
 * status：queued 排队中、playing 正在放、played 放完了、skipped 切掉了、cancelled 观众取消或后台删掉、failed 放不了
 */
export const musicRequests = sqliteTable(
  'music_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roomId: integer('room_id'),
    source: text('source').$type<MusicSource>().notNull(),
    songId: text('song_id').notNull(),
    name: text('name').notNull(),
    artists: text('artists').notNull().default(''),
    album: text('album').notNull().default(''),
    cover: text('cover').notNull().default(''),
    durationMs: integer('duration_ms').notNull().default(0),
    uid: integer('uid').notNull(),
    uname: text('uname').notNull(),
    face: text('face').notNull().default(''),
    guard: integer('guard').notNull().default(0),
    status: text('status').$type<'queued' | 'playing' | 'played' | 'skipped' | 'cancelled' | 'failed'>().notNull(),
    /** 列表里的顺序（小的在前） */
    sort: integer('sort').notNull().default(0),
    /** 说明：放不了的原因、谁切的 */
    note: text('note'),
    createdAt: integer('created_at').notNull().default(now),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
  },
  (t) => [index('music_requests_status').on(t.status, t.sort), index('music_requests_created').on(t.createdAt)],
);

/** 本地歌库：上传的文件按内容哈希存在 data/music 里（sha256）；桌面版选的文件夹里的文件记完整路径（path） */
export const musicLocal = sqliteTable(
  'music_local',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sha256: text('sha256'),
    path: text('path'),
    ext: text('ext').notNull(),
    filename: text('filename').notNull(),
    size: integer('size').notNull(),
    title: text('title').notNull(),
    artist: text('artist').notNull().default(''),
    album: text('album').notNull().default(''),
    durationMs: integer('duration_ms').notNull().default(0),
    /** 封面文件名（data/music 里），没有封面时为空 */
    cover: text('cover'),
    /** 歌词（LRC），文件自带的或另外上传的 .lrc */
    lyric: text('lyric'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('music_local_sha256').on(t.sha256), uniqueIndex('music_local_path').on(t.path)],
);
