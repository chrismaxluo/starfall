// 测试辅助：用临时数据目录和内存数据库启动服务
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';

export const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures');

export async function testApp(opts: { maxUpload?: number } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starfall-test-'));
  const ctx = createContext(loadConfig({ STARFALL_DATA: dataDir }), { dbFile: ':memory:', ...opts });
  const app = await buildApp(ctx);
  app.addHook('onClose', async () => fs.rmSync(dataDir, { recursive: true, force: true }));
  const password = ctx.initialPassword!;
  /** 登录后返回带 Cookie 的请求函数 */
  const login = async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
    const cookie = res.cookies.find((c) => c.name === 'sf_session')!;
    return (opts: InjectOptions) => app.inject({ ...opts, cookies: { ...opts.cookies, sf_session: cookie.value } });
  };
  return { app, ctx, dataDir, password, login };
}

/** 组装上传用的表单（字段名 file） */
export function formFile(filename: string, content: Buffer | string): Pick<InjectOptions, 'payload' | 'headers'> {
  const boundary = `----starfall${Math.random().toString(16).slice(2)}`;
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), Buffer.from(content), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** 测试用的媒体文件 */
export const media = (name: string) => fs.readFileSync(path.join(FIXTURES, 'media', name));
