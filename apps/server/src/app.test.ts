import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('健康检查', () => {
  const app = buildApp();
  afterAll(() => app.close());

  it('GET /api/health 返回 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, name: '星临' });
  });
});
