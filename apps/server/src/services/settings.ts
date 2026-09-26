// 键值设置的读写（带默认值）
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { settings } from '../db/schema.ts';
import { DEFAULT_SETTINGS } from '../db/seed.ts';
import type { Settings } from '../db/seed.ts';

export class SettingsStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return (row ? row.value : DEFAULT_SETTINGS[key]) as Settings[K];
  }

  all(): Settings {
    const out = { ...DEFAULT_SETTINGS };
    for (const row of this.db.select().from(settings).all()) if (row.key in out) (out as Record<string, unknown>)[row.key] = row.value;
    return out;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  /** 不在默认设置里的内部键值（例如后台密码哈希） */
  getRaw<T>(key: string): T | undefined {
    return this.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined;
  }

  setRaw(key: string, value: unknown): void {
    this.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }
}
