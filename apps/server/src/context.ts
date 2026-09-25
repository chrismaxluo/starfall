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
import { BlacklistStore } from './services/blacklist.ts';
import { BiliAccount } from './services/bili-account.ts';
import { EffectStore } from './services/effects.ts';
import { EventLog } from './services/events.ts';
import { Hub } from './services/hub.ts';
import { LiveService } from './services/live.ts';
import type { LiveDeps } from './services/live.ts';
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
  assets: AssetStore;
  effects: EffectStore;
  viewers: ViewerStore;
  enterRules: EnterRuleStore;
  outputs: OutputStore;
  blacklist: BlacklistStore;
  log: EventLog;
  hub: Hub;
  pipeline: Pipeline;
  /** 首次启动生成的初始密码（只在首次启动时有值，用于打印到日志） */
  initialPassword: string | null;
}

export function createContext(config: Config, opts: { dbFile?: string; liveDeps?: LiveDeps; maxUpload?: number } = {}): AppContext {
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
  const assets = new AssetStore(db, p, opts.maxUpload);
  const effects = new EffectStore(db, assets);
  const viewers = new ViewerStore(db, () => account.anon);
  const enterRules = new EnterRuleStore(db, settings, viewers);
  const outputs = new OutputStore(db);
  const blacklist = new BlacklistStore({ db, settings, room, account });
  const log = new EventLog(db);
  const hub = new Hub();
  const pipeline = new Pipeline({ live, room, settings, enterRules, effects, blacklist, viewers, log, hub, timeZone: config.timeZone });

  // 把变化推给在线的特效页和管理后台
  outputs.onChange((o, change) => hub.outputChanged(o, change));
  live.onStatus(() => hub.toAdmins({ type: 'status', status: { live: live.status(), paused: settings.get('paused'), overlays: hub.overlayCount() } }));
  log.onChange((m) => hub.toAdmins(m));
  pipeline.onQueueChange((queue) => hub.toAdmins({ type: 'queue', queue, paused: settings.get('paused') }));
  hub.onOverlaysChange(() => hub.toAdmins({ type: 'overlays', overlays: hub.overlayList() }));

  return { config, db, secret, settings, auth, account, room, live, assets, effects, viewers, enterRules, outputs, blacklist, log, hub, pipeline, initialPassword };
}

const PRUNE_MS = 6 * 3600_000;

/** 启动后台任务：直播连接、事件管道、定时清理事件记录。返回停止函数 */
export async function startBackground(ctx: AppContext): Promise<() => void> {
  const prune = () => ctx.log.prune(Date.now(), ctx.settings.get('retentionDays'));
  prune();
  const timer = setInterval(prune, PRUNE_MS);
  ctx.pipeline.start();
  await ctx.live.start();
  return () => {
    clearInterval(timer);
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
