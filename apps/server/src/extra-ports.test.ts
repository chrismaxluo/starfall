import net from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { listenExtra, parseExtraPorts } from './extra-ports.ts';
import { testApp } from './testing.ts';

let cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

/** 找一个现在空着的端口 */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

it('解析备用端口：去掉格式不对的、重复的和主端口', () => {
  expect(parseExtraPorts('17521, 17522,abc,,0,70000,17520,17521', 17520)).toEqual([17521, 17522]);
  expect(parseExtraPorts(undefined, 17520)).toEqual([]);
});

it('备用端口上的网页和特效页连接都交给同一个服务', async () => {
  const { app, ctx } = await testApp({}, { STARFALL_DESKTOP: '1' });
  cleanup.push(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const extra = await freePort();
  const errors: number[] = [];
  const close = listenExtra(app.server, [extra], '127.0.0.1', (p) => errors.push(p));
  cleanup.push(close);
  await new Promise((r) => setTimeout(r, 50));

  const res = await fetch(`http://127.0.0.1:${extra}/api/health`);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

  const [output] = ctx.outputs.list();
  const ws = new WebSocket(`ws://127.0.0.1:${extra}/ws/overlay?output=${output!.id}&key=${output!.key}`);
  cleanup.push(() => ws.close());
  const first = await new Promise<{ type: string }>((resolve, reject) => {
    ws.addEventListener('message', (e) => resolve(JSON.parse(String(e.data)) as { type: string }), { once: true });
    ws.addEventListener('error', () => reject(new Error('连不上')), { once: true });
  });
  expect(first.type).toBe('hello');
  expect(ctx.hub.overlayCount()).toBe(1);
  expect(errors).toEqual([]);
});

it('被占用的备用端口只报错，不影响服务', async () => {
  const { app } = await testApp();
  cleanup.push(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as net.AddressInfo;
  const errors: number[] = [];
  cleanup.push(listenExtra(app.server, [port], '127.0.0.1', (p) => errors.push(p)));
  await new Promise((r) => setTimeout(r, 50));
  expect(errors).toEqual([port]);
  expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
});
