// 每天自动备份（需求 F-DA-03）：用 SQLite 的在线备份功能复制数据库，同时保存一份导出配置（含素材清单），
// 放在 data/backups/，保留最近 7 份。数据库里的登录信息是加密的，密钥 secret.key 不在备份里。
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/index.ts';
import type { ConfigIO } from './config-io.ts';
import type { SettingsStore } from './settings.ts';

export const KEEP_BACKUPS = 7;
/** 凌晨几点之后做当天的备份（服务器时区按直播间所在地） */
const BACKUP_HOUR = 4;
const CHECK_MS = 3600_000;
const NAME = /^starfall-(\d{8}-\d{4})\.(db|json)$/;

export interface BackupItem {
  /** 备份时间标记，例如 20260926-0400 */
  stamp: string;
  at: number;
  dbSize: number;
  /** 导出配置的文件名（可以下载后导入） */
  config: string | null;
  configSize: number;
}

export class BackupService {
  private readonly db: Db;
  private readonly settings: SettingsStore;
  private readonly io: ConfigIO;
  private readonly dir: string;
  private readonly fmt: Intl.DateTimeFormat;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<BackupItem> | null = null;

  constructor(opts: { db: Db; settings: SettingsStore; io: ConfigIO; dir: string; timeZone: string }) {
    this.db = opts.db;
    this.settings = opts.settings;
    this.io = opts.io;
    this.dir = opts.dir;
    this.fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: opts.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /** 本地时间 → { day: 20260926, stamp: 20260926-0400, hour } */
  private local(ms: number): { day: string; stamp: string; hour: number } {
    const s = this.fmt.format(ms); // 2026-09-26 04:00
    const day = s.slice(0, 10).replaceAll('-', '');
    return { day, stamp: `${day}-${s.slice(11, 13)}${s.slice(14, 16)}`, hour: Number(s.slice(11, 13)) };
  }

  /** 文件名里用的本地时间，例如 20260926-0400 */
  stamp(now = Date.now()): string {
    return this.local(now).stamp;
  }

  list(): BackupItem[] {
    if (!fs.existsSync(this.dir)) return [];
    const by = new Map<string, BackupItem>();
    for (const f of fs.readdirSync(this.dir)) {
      const m = NAME.exec(f);
      if (!m) continue;
      const st = fs.statSync(path.join(this.dir, f));
      const it = by.get(m[1]!) ?? { stamp: m[1]!, at: st.mtimeMs, dbSize: 0, config: null, configSize: 0 };
      if (m[2] === 'db') it.dbSize = st.size;
      else {
        it.config = f;
        it.configSize = st.size;
      }
      it.at = Math.min(it.at, st.mtimeMs);
      by.set(m[1]!, it);
    }
    return [...by.values()].sort((a, b) => b.stamp.localeCompare(a.stamp));
  }

  /** 备份文件的完整路径；名称不合法或不存在时返回 null（防止路径穿越） */
  file(name: string): string | null {
    if (!NAME.test(name)) return null;
    const p = path.join(this.dir, name);
    return fs.existsSync(p) ? p : null;
  }

  /** 立即备份一次（同一时间只跑一个） */
  run(now = Date.now()): Promise<BackupItem> {
    this.running ??= this.doRun(now).finally(() => (this.running = null));
    return this.running;
  }

  private async doRun(now: number): Promise<BackupItem> {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const { stamp } = this.local(now);
    const dbFile = path.join(this.dir, `starfall-${stamp}.db`);
    const tmp = `${dbFile}.part`;
    await this.db.$client.backup(tmp);
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, dbFile);
    fs.writeFileSync(path.join(this.dir, `starfall-${stamp}.json`), JSON.stringify(this.io.export(), null, 2), { mode: 0o600 });
    this.prune();
    return this.list().find((b) => b.stamp === stamp)!;
  }

  /** 只保留最近 KEEP_BACKUPS 份 */
  private prune(): void {
    for (const old of this.list().slice(KEEP_BACKUPS)) {
      for (const ext of ['db', 'json']) fs.rmSync(path.join(this.dir, `starfall-${old.stamp}.${ext}`), { force: true });
    }
  }

  /** 定时检查：开启了自动备份、今天还没备份、已经过了凌晨 4 点，就备份一次 */
  async tick(now = Date.now()): Promise<boolean> {
    if (!this.settings.get('autoBackup')) return false;
    const { day, hour } = this.local(now);
    if (hour < BACKUP_HOUR) return false;
    if (this.list().some((b) => b.stamp.startsWith(day))) return false;
    await this.run(now);
    return true;
  }

  start(onError: (e: unknown) => void): void {
    const check = () => void this.tick().catch(onError);
    check();
    this.timer = setInterval(check, CHECK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
