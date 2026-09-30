// 服务运行所需的全部依赖，集中创建，便于测试时替换。
import type { Config } from './config.ts';
import { paths } from './config.ts';
import { openDb } from './db/index.ts';
import type { Db } from './db/index.ts';
import { seed } from './db/seed.ts';
import fs from 'node:fs';
import path from 'node:path';
import { AssetStore } from './services/assets.ts';
import { AdminAuth } from './services/auth.ts';
import { BackupService } from './services/backup.ts';
import { BlacklistStore } from './services/blacklist.ts';
import { BuildVersion } from './services/build-version.ts';
import { BiliAccount } from './services/bili-account.ts';
import { ConfigIO } from './services/config-io.ts';
import { EffectStore } from './services/effects.ts';
import { DanmuRuleStore, GiftRuleStore, GuardRuleStore } from './services/event-rules.ts';
import { EventLog } from './services/events.ts';
import type { getRoomGifts } from '@starfall/bili';
import { GiftCatalog } from './services/gifts.ts';
import { Hub } from './services/hub.ts';
import { LiveService } from './services/live.ts';
import type { LiveDeps } from './services/live.ts';
import { RoomInfoService } from './services/room-info.ts';
import type { RoomInfoDeps } from './services/room-info.ts';
import { OutputStore } from './services/outputs.ts';
import { Pipeline } from './services/pipeline.ts';
import { RoomStore } from './services/room.ts';
import { EnterRuleStore } from './services/rules.ts';
import { Secret } from './services/secret.ts';
import { SettingsStore } from './services/settings.ts';
import { ViewerStore } from './services/viewers.ts';

export interface AppContext {
  config: Config;
  db: Db;
  secret: Secret;
  settings: SettingsStore;
  auth: AdminAuth;
  account: BiliAccount;
  room: RoomStore;
  live: LiveService;
  roomInfo: RoomInfoService;
  assets: AssetStore;
  effects: EffectStore;
  viewers: ViewerStore;
  enterRules: EnterRuleStore;
  danmuRules: DanmuRuleStore;
  giftRules: GiftRuleStore;
  guardRules: GuardRuleStore;
  gifts: GiftCatalog;
  outputs: OutputStore;
  blacklist: BlacklistStore;
  log: EventLog;
  hub: Hub;
  overlayBuild: BuildVersion;
  adminBuild: BuildVersion;
  pipeline: Pipeline;
  io: ConfigIO;
  backups: BackupService;
  /** 首次启动生成的初始密码（只在首次启动时有值，用于打印到日志） */
  initialPassword: string | null;
}

export function createContext(config: Config, opts: { dbFile?: string; liveDeps?: LiveDeps; roomInfoDeps?: RoomInfoDeps; maxUpload?: number; fetchGifts?: typeof getRoomGifts } = {}): AppContext {
  const p = paths(config.dataDir);
  const db = openDb(opts.dbFile ?? p.db);
  seed(db);
  const secret = Secret.load(p.secretKey);
  const settings = new SettingsStore(db);
  const auth = new AdminAuth(settings, secret, config.dataDir);
  const initialPassword = auth.ensurePassword();
  const account = new BiliAccount(db, secret);
  const room = new RoomStore(db);
  const live = new LiveService({ db, account, room, settings }, opts.liveDeps);
  const roomInfo = new RoomInfoService({ room, live, http: () => account.anon, authHttp: () => account.http() }, opts.roomInfoDeps);
  const assets = new AssetStore(db, p, opts.maxUpload);
  const effects = new EffectStore(db, assets);
  const viewers = new ViewerStore(db, () => account.anon, Date.now, () => room.get()?.roomId ?? null);
  const enterRules = new EnterRuleStore(db, settings, viewers);
  const outputs = new OutputStore(db);
  const danmuRules = new DanmuRuleStore(db);
  const giftRules = new GiftRuleStore(db, settings);
  const guardRules = new GuardRuleStore(db);
  const gifts = new GiftCatalog(room, () => account.anon, opts.fetchGifts);
  const blacklist = new BlacklistStore({ db, settings, room, account });
  const log = new EventLog(db);
  const overlayBuild = new BuildVersion(config.overlayDist);
  const adminBuild = new BuildVersion(config.adminDist);
  const hub = new Hub({ build: () => overlayBuild.current() });
  const pipeline = new Pipeline({ live, gifts, room, settings, enterRules, danmuRules, giftRules, guardRules, effects, blacklist, viewers, log, hub, timeZone: config.timeZone });

  const io = new ConfigIO({ db, settings, assets, enterRules, danmuRules, giftRules, guardRules, blacklist, outputs });
  const backups = new BackupService({ db, settings, io, dir: p.backups, timeZone: config.timeZone });

  // 把变化推给在线的特效页和管理后台
  outputs.onChange((o, change) => hub.outputChanged(o, change));
  live.onStatus(() => hub.toAdmins({ type: 'status', status: { live: live.status(), paused: settings.get('paused'), overlays: hub.overlayCount() } }));
  log.onChange((m) => hub.toAdmins(m));
  pipeline.onQueueChange((queue) => hub.toAdmins({ type: 'queue', queue, paused: settings.get('paused') }));
  hub.onOverlaysChange(() => hub.toAdmins({ type: 'overlays', overlays: hub.overlayList() }));
  roomInfo.onChange((info) => hub.toAdmins({ type: 'room_info', info }));

  return { config, db, secret, settings, auth, account, room, live, roomInfo, assets, effects, viewers, enterRules, danmuRules, giftRules, guardRules, gifts, outputs, blacklist, log, hub, overlayBuild, adminBuild, pipeline, io, backups, initialPassword };
}

const PRUNE_MS = 6 * 3600_000;

/** 启动后台任务：直播连接、事件管道、定时清理事件记录。返回停止函数 */
export async function startBackground(ctx: AppContext): Promise<() => void> {
  const prune = () => {
    try {
      const days = ctx.settings.get('retentionDays');
      ctx.log.prune(Date.now(), days);
      ctx.viewers.prune(days);
      // 导入包等待确认最多 30 分钟，超过 1 小时的临时文件都没用了
      ctx.assets.cleanTmp(3600_000);
    } catch (e) {
      console.error('清理事件记录失败', e);
    }
  };
  ctx.assets.cleanTmp(0);
  void ctx.assets.backfillSlots().catch((e: Error) => console.error('读取 SVGA 图层失败', e.message));
  ctx.backups.cleanPartial();
  prune();
  const timer = setInterval(prune, PRUNE_MS);
  ctx.gifts.start();
  ctx.pipeline.start();
  ctx.backups.start((e) => console.error('自动备份失败', e));
  // 重新构建了特效页：告诉在线的页面，旧页面会在空闲时自动刷新
  const stopBuild = ctx.overlayBuild.watch((build) => ctx.hub.toOverlays({ type: 'version', build }));
  // 重新构建了后台（不用重启服务）：打开着的旧后台页面顶部提示刷新
  const stopAdminBuild = ctx.adminBuild.watch((build) => ctx.hub.toAdmins({ type: 'version', build }));
  await ctx.live.start();
  void ctx.roomInfo.start().catch((e: Error) => console.error('查询直播间信息失败', e.message));
  return () => {
    clearInterval(timer);
    stopBuild();
    stopAdminBuild();
    ctx.roomInfo.stop();
    ctx.backups.stop();
    ctx.pipeline.stop();
    ctx.live.stop();
  };
}

/**
 * 技术验证（spike/login.ts）时保存的明文登录信息：加密导入数据库后删除明文文件。
 * 只在数据库里还没有账号时导入。返回是否导入了。
 */
export async function importSpikeAccount(ctx: AppContext): Promise<boolean> {
  const file = path.join(ctx.config.dataDir, 'bili-account.json');
  if (!fs.existsSync(file)) return false;
  if (ctx.account.status().loggedIn) {
    fs.rmSync(file);
    return false;
  }
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { cookies: Record<string, string>; refreshToken?: string; sessdataExpires?: string | null };
  await ctx.account.save(j.cookies, j.refreshToken ?? '', j.sessdataExpires ? Date.parse(j.sessdataExpires) || null : null);
  fs.rmSync(file);
  return true;
}
