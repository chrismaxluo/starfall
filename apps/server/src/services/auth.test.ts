import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index.ts';
import { AdminAuth } from './auth.ts';
import { Secret } from './secret.ts';
import { SettingsStore } from './settings.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'starfall-'));

describe('加密', () => {
  it('加密后能解密；每次密文不同；被篡改时报错', () => {
    const s = new Secret(crypto.randomBytes(32));
    const a = s.encrypt('SESSDATA=abc'), b = s.encrypt('SESSDATA=abc');
    expect(a).not.toBe(b);
    expect(s.decrypt(a)).toBe('SESSDATA=abc');
    const parts = a.split('.'); parts[3] = Buffer.from('xx').toString('base64');
    expect(() => s.decrypt(parts.join('.'))).toThrow();
    expect(() => new Secret(crypto.randomBytes(32)).decrypt(a)).toThrow();
  });

  it('密钥文件首次生成（权限 600），之后读取同一把', () => {
    const f = path.join(tmp(), 'secret.key');
    const s1 = Secret.load(f);
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(Secret.load(f).decrypt(s1.encrypt('x'))).toBe('x');
  });
});

describe('后台登录', () => {
  const setup = () => {
    const dir = tmp();
    const auth = new AdminAuth(new SettingsStore(openDb(':memory:')), new Secret(crypto.randomBytes(32)), dir);
    return { dir, auth };
  };

  it('首次生成初始密码并写入文件；再次调用不会重新生成', () => {
    const { dir, auth } = setup();
    const pw = auth.ensurePassword()!;
    expect(pw.length).toBeGreaterThanOrEqual(12);
    expect(fs.readFileSync(path.join(dir, 'initial-password.txt'), 'utf8')).toContain(pw);
    expect(auth.ensurePassword()).toBeNull();
    expect(auth.verify(pw)).toBe(true);
    expect(auth.verify('wrong')).toBe(false);
  });

  it('会话：有效、过期、被篡改', () => {
    const { auth } = setup();
    auth.ensurePassword();
    const { token } = auth.issueSession(1000);
    expect(auth.checkSession(token, 2000)).toBe(true);
    expect(auth.checkSession(token, 1000 + 31 * 86400_000)).toBe(false);
    expect(auth.checkSession(token.slice(0, -2) + 'xx', 2000)).toBe(false);
    expect(auth.checkSession(undefined)).toBe(false);
    expect(auth.checkSession('garbage')).toBe(false);
  });

  it('修改密码后旧会话失效、初始密码文件删除；新密码至少 8 位', () => {
    const { dir, auth } = setup();
    const pw = auth.ensurePassword()!;
    const { token } = auth.issueSession();
    expect(() => auth.changePassword('wrong', 'newpassword')).toThrow('当前密码不正确');
    expect(() => auth.changePassword(pw, 'short')).toThrow('至少 8 位');
    auth.changePassword(pw, 'newpassword');
    expect(auth.checkSession(token)).toBe(false);
    expect(auth.verify('newpassword')).toBe(true);
    expect(fs.existsSync(path.join(dir, 'initial-password.txt'))).toBe(false);
  });
});

describe('忘记密码', () => {
  it('重置后旧密码和旧登录失效，新密码写入文件；改密码后不再提示初始密码', async () => {
    const { testApp } = await import('../testing.ts');
    const t = await testApp();
    const old = t.password;
    const session = t.ctx.auth.issueSession().token;
    expect(t.ctx.auth.usingInitialPassword()).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/setup' })).json()).toEqual({ initialPassword: true });

    const pw = t.ctx.auth.resetPassword();
    expect(pw).not.toBe(old);
    expect(t.ctx.auth.verify(old)).toBe(false);
    expect(t.ctx.auth.verify(pw)).toBe(true);
    expect(t.ctx.auth.checkSession(session)).toBe(false);
    const fsm = await import('node:fs');
    const pathm = await import('node:path');
    expect(fsm.readFileSync(pathm.join(t.dataDir, 'initial-password.txt'), 'utf8')).toContain(pw);

    t.ctx.auth.changePassword(pw, 'my-new-password');
    expect(t.ctx.auth.usingInitialPassword()).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/setup' })).json()).toEqual({ initialPassword: false });
    await t.app.close();
  });
});
