// 端到端：假的 B 站弹幕服务器（真实数据包格式、brotli 压缩）→ 正式的连接、解析、管道 → 真实的特效页 WebSocket。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket as ServerSocket } from '@fastify/websocket';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveClient, OP, decodePackets, encodePacket } from '@starfall/bili';
import type { ServerToOverlay } from '@starfall/shared';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createContext, startBackground } from './context.ts';
import { account, room } from './db/schema.ts';
import { FIXTURES } from './testing.ts';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'bili', name), 'utf8')) as object;

/** 和 B 站一样：多条消息打包后用 brotli 压缩（版本 3） */
function brotliPacket(msgs: object[]): Buffer {
  const inner = zlib.brotliCompressSync(Buffer.concat(msgs.map((m) => encodePacket(OP.MESSAGE, JSON.stringify(m)))));
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16 + inner.length, 0);
  head.writeUInt16BE(16, 4);
  head.writeUInt16BE(3, 6);
  head.writeUInt32BE(OP.MESSAGE, 8);
  head.writeUInt32BE(0, 12);
  return Buffer.concat([head, inner]);
}

async function fakeBili() {
  const app = Fastify();
  await app.register(websocket);
  const auths: Array<Record<string, unknown>> = [];
  let heartbeats = 0;
  let sock: ServerSocket | null = null;
  app.register(async (s) =>
    s.get('/sub', { websocket: true }, (socket) => {
      sock = socket;
      socket.on('message', (data) => {
        for (const p of decodePackets(data as Buffer)) {
          if (p.op === OP.AUTH) {
            auths.push(JSON.parse(p.body.toString()));
            socket.send(encodePacket(OP.AUTH_REPLY, '{"code":0}'));
          } else if (p.op === OP.HEARTBEAT) {
            heartbeats++;
            const pop = Buffer.alloc(4);
            pop.writeUInt32BE(1234);
            socket.send(encodePacket(OP.HEARTBEAT_REPLY, pop));
          }
        }
      });
    }),
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  return { app, port, auths, heartbeats: () => heartbeats, push: (...msgs: object[]) => sock!.send(brotliPacket(msgs)), connected: () => sock !== null };
}

let cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.reverse()) await c(); cleanup = []; });

it('舰长进场：B 站消息 → 合并 → 匹配 → 推送给特效页；下播后不再播放', async () => {
  const bili = await fakeBili();
  cleanup.push(() => bili.app.close());

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starfall-e2e-'));
  cleanup.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let liveStatus = 1;
  const ctx = createContext(loadConfig({ STARFALL_DATA: dataDir }), {
    dbFile: ':memory:',
    fetchGifts: async () => [],
    liveDeps: {
      getRoomInit: async () => ({ roomId: 30000, shortId: 0, anchorUid: 20000, liveStatus, isPortrait: true }),
      getRoomAdmins: async () => [],
      getDanmuInfo: async () => ({ token: 'test-token', hosts: [{ host: '127.0.0.1', wssPort: bili.port }] }),
      createClient: (o) => new LiveClient({ ...o, urlFor: (h) => `ws://${h.host}:${h.wssPort}/sub` }),
      now: Date.now,
    },
    roomInfoDeps: {
      getRoomInfo: async () => ({ roomId: 30000, anchorUid: 20000, title: '测试直播', liveStatus: 1, liveTime: '', liveSince: null, isPortrait: true, parentAreaName: '娱乐', areaName: '视频唱见', cover: '', keyframe: '', followers: 10 }),
      getAnchorInfo: async () => ({ uid: 20000, name: '主播', face: '', followers: 10 }),
      getLiveCounts: async () => ({ likes: 5, watched: 6 }),
      now: Date.now,
    },
  });
  ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '主播' }).run();
  ctx.db.insert(account).values({ id: 1, uid: 10099, cookiesEnc: ctx.secret.encrypt(JSON.stringify({ SESSDATA: 's', DedeUserID: '10099', bili_jct: 'c', buvid3: 'B3' })) }).run();

  const app = await buildApp(ctx);
  cleanup.push(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };

  // 特效页先上线
  const [output] = ctx.outputs.list();
  const overlay = new WebSocket(`ws://127.0.0.1:${port}/ws/overlay?output=${output!.id}&key=${output!.key}`);
  cleanup.push(() => overlay.close());
  const got: ServerToOverlay[] = [];
  overlay.addEventListener('message', (e) => got.push(JSON.parse(String(e.data))));
  await vi.waitFor(() => expect(got[0]?.type).toBe('hello'));

  const stop = await startBackground(ctx);
  cleanup.push(stop);

  // 开播 → 用账号连接，认证信息正确
  await vi.waitFor(() => expect(bili.auths).toHaveLength(1), { timeout: 5000 });
  expect(bili.auths[0]).toMatchObject({ uid: 10099, roomid: 30000, protover: 3, buvid: 'B3', key: 'test-token' });
  await vi.waitFor(() => expect(ctx.live.status().connection).toBe('connected'));
  expect(bili.heartbeats()).toBeGreaterThanOrEqual(1);

  // 同一次进场的两条消息（ENTRY_EFFECT 先到）+ 一条弹幕
  bili.push(fixture('entry_effect.guard.json'));
  await new Promise((r) => setTimeout(r, 300));
  bili.push(fixture('interact_word_v2.enter.guard-medal.json'), fixture('danmu_msg.guard-mod.json'));

  await vi.waitFor(() => expect(got.some((m) => m.type === 'play')).toBe(true), { timeout: 5000 });
  const play = got.find((m) => m.type === 'play') as Extract<ServerToOverlay, { type: 'play' }>;
  expect(play.item).toMatchObject({
    kind: 'enter',
    text: '恭迎舰长 测试舰长',
    effect: { name: '门楼', visual: { type: 'builtin_style', style: 'royal-cap' }, durationMs: 4000 },
    viewer: { name: '测试舰长', guard: 3, medal: { name: '测试牌', level: 25, colors: { border: '#5FC7F4' } } },
  });

  const rows = ctx.log.query({}).events;
  expect(rows.map((e) => [e.kind, e.rule, e.status])).toEqual([
    ['danmu', null, 'no_rule'],
    ['enter', '进场 · 舰长', 'played'],
  ]);
  const raw = ctx.db.$client.prepare("select raw from events where kind = 'enter'").get() as { raw: string };
  expect(JSON.parse(raw.raw)).toMatchObject({ cmd: 'INTERACT_WORD_V2' });

  // 下播：结束场次、断开连接；之后的进场记录为未开播（这里直接交给管道，因为连接已经断开）
  liveStatus = 0;
  bili.push(fixture('preparing.json'));
  await vi.waitFor(() => expect(ctx.live.status()).toMatchObject({ live: false, connection: 'idle', reason: 'offline' }));
  ctx.pipeline.handle({ kind: 'enter', id: 'late', ts: Date.now(), source: 'interact', viewer: { uid: 10002, name: '晚到的', guard: 3, isMod: false, mystery: false } });
  expect(ctx.log.query({ limit: 1 }).events[0]).toMatchObject({ uid: 10002, status: 'offline' });
  expect(got.filter((m) => m.type === 'play')).toHaveLength(1);
});
