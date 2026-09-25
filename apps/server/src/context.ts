// 服务运行所需的全部依赖，集中创建，便于测试时替换。
import type { Config } from './config.ts';
import { paths } from './config.ts';
import { openDb } from './db/index.ts';
import type { Db } from './db/index.ts';
import { seed } from './db/seed.ts';
import fs from 'node:fs';
import path from 'node:path';
import { AdminAuth } from './services/auth.ts';
import { BiliAccount } from './services/bili-account.ts';
import { LiveService } from './services/live.ts';
import type { LiveDeps } from './services/live.ts';
import { RoomStore } from './services/room.ts';
import { Secret } from './services/secret.ts';
import { SettingsStore } from './services/settings.ts';

export interface AppContext {
  config: Config;
  db: Db;
  secret: Secret;
  settings: SettingsStore;
  auth: AdminAuth;
  account: BiliAccount;
  room: RoomStore;
  live: LiveService;
  /** 首次启动生成的初始密码（只在首次启动时有值，用于打印到日志） */
  initialPassword: string | null;
}

export function createContext(config: Config, opts: { dbFile?: string; liveDeps?: LiveDeps } = {}): AppContext {
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
  return { config, db, secret, settings, auth, account, room, live, initialPassword };
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
