// 服务运行所需的全部依赖，集中创建，便于测试时替换。
import type { Config } from './config.ts';
import { paths } from './config.ts';
import { openDb } from './db/index.ts';
import type { Db } from './db/index.ts';
import { seed } from './db/seed.ts';
import { AdminAuth } from './services/auth.ts';
import { Secret } from './services/secret.ts';
import { SettingsStore } from './services/settings.ts';

export interface AppContext {
  config: Config;
  db: Db;
  secret: Secret;
  settings: SettingsStore;
  auth: AdminAuth;
  /** 首次启动生成的初始密码（只在首次启动时有值，用于打印到日志） */
  initialPassword: string | null;
}

export function createContext(config: Config, opts: { dbFile?: string } = {}): AppContext {
  const p = paths(config.dataDir);
  const db = openDb(opts.dbFile ?? p.db);
  seed(db);
  const secret = Secret.load(p.secretKey);
  const settings = new SettingsStore(db);
  const auth = new AdminAuth(settings, secret, config.dataDir);
  const initialPassword = auth.ensurePassword();
  return { config, db, secret, settings, auth, initialPassword };
}
