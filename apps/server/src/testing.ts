// 测试辅助：用临时数据目录和内存数据库启动服务
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';

export async function testApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starfall-test-'));
  const ctx = createContext(loadConfig({ STARFALL_DATA: dataDir }), { dbFile: ':memory:' });
  const app = await buildApp(ctx);
  const password = ctx.initialPassword!;
  /** 登录后返回带 Cookie 的请求函数 */
  const login = async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
    const cookie = res.cookies.find((c) => c.name === 'sf_session')!;
    return (opts: InjectOptions) => app.inject({ ...opts, cookies: { ...opts.cookies, sf_session: cookie.value } });
  };
  return { app, ctx, dataDir, password, login };
}
