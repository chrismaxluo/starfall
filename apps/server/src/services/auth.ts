// 后台登录（需求 F-UI-10）：密码用 scrypt 哈希存储；首次启动生成随机初始密码。
// 会话是签名的 Cookie（不在服务端保存），修改密码后旧会话全部失效。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Secret } from './secret.ts';
import type { SettingsStore } from './settings.ts';

const KEY = 'admin_password';
const SESSION_DAYS = 30;

interface PasswordRecord {
  salt: string;
  hash: string;
  /** 每次修改密码加 1，旧会话随之失效 */
  version: number;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64');
}

export class AdminAuth {
  private readonly settings: SettingsStore;
  private readonly secret: Secret;
  private readonly initialPasswordFile: string;

  constructor(settings: SettingsStore, secret: Secret, dataDir: string) {
    this.settings = settings;
    this.secret = secret;
    this.initialPasswordFile = path.join(dataDir, 'initial-password.txt');
  }

  /** 没有密码时生成初始密码，写入 data/initial-password.txt 并返回；已有密码返回 null */
  ensurePassword(): string | null {
    if (this.settings.getRaw<PasswordRecord>(KEY)) return null;
    return this.generate(1);
  }

  /** 忘记密码：生成新的随机密码（写入 data/initial-password.txt），原来的登录全部失效 */
  resetPassword(): string {
    return this.generate((this.settings.getRaw<PasswordRecord>(KEY)?.version ?? 0) + 1);
  }

  /** 是否还在用初始密码（登录页据此显示"初始密码在哪"） */
  usingInitialPassword(): boolean {
    return fs.existsSync(this.initialPasswordFile);
  }

  private generate(version: number): string {
    const pw = crypto.randomBytes(9).toString('base64url');
    this.write(pw, version);
    fs.mkdirSync(path.dirname(this.initialPasswordFile), { recursive: true });
    fs.writeFileSync(this.initialPasswordFile, `星临管理后台初始密码：${pw}\n登录后请在设置里修改，修改后这个文件会自动删除。\n`, { mode: 0o600 });
    return pw;
  }

  verify(password: string): boolean {
    const rec = this.settings.getRaw<PasswordRecord>(KEY);
    if (!rec) return false;
    const a = Buffer.from(hashPassword(password, rec.salt));
    const b = Buffer.from(rec.hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  changePassword(current: string, next: string): void {
    if (!this.verify(current)) throw new AuthError('当前密码不正确');
    if (next.length < 8) throw new AuthError('新密码至少 8 位');
    const rec = this.settings.getRaw<PasswordRecord>(KEY)!;
    this.write(next, rec.version + 1);
    fs.rmSync(this.initialPasswordFile, { force: true });
  }

  /** 生成会话令牌：到期时间.签名 */
  issueSession(now = Date.now()): { token: string; maxAgeSec: number } {
    const rec = this.settings.getRaw<PasswordRecord>(KEY)!;
    const exp = now + SESSION_DAYS * 86400_000;
    return { token: `${exp}.${this.secret.hmac(`${exp}:${rec.version}`)}`, maxAgeSec: SESSION_DAYS * 86400 };
  }

  checkSession(token: string | undefined, now = Date.now()): boolean {
    if (!token) return false;
    const [expStr, sig] = token.split('.');
    const exp = Number(expStr);
    const rec = this.settings.getRaw<PasswordRecord>(KEY);
    if (!rec || !sig || !Number.isFinite(exp) || exp < now) return false;
    const expect = Buffer.from(this.secret.hmac(`${exp}:${rec.version}`));
    const got = Buffer.from(sig);
    return expect.length === got.length && crypto.timingSafeEqual(expect, got);
  }

  private write(password: string, version: number): void {
    const salt = crypto.randomBytes(16).toString('base64');
    this.settings.setRaw(KEY, { salt, hash: hashPassword(password, salt), version } satisfies PasswordRecord);
  }
}

export class AuthError extends Error {
  override name = 'AuthError';
}
