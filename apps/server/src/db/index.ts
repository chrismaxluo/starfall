// 打开数据库并执行迁移。WAL 模式：读写互不阻塞；开启外键：被引用的素材不能删除。
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

// 桌面版把服务打包成一个文件，迁移文件另外放，用环境变量指过去
const MIGRATIONS = process.env.STARFALL_MIGRATIONS || path.resolve(import.meta.dirname, '../../drizzle');

/** file 传 ':memory:' 时使用内存数据库（测试用） */
export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  // 数据库里有加密后的登录信息，只允许运行账号读写
  if (file !== ':memory:') for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

export { schema };
