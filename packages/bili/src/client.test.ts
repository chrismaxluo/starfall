import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsSocket } from 'ws';
import { LiveClient } from './client.ts';
import type { ClientState } from './client.ts';
import { decodePackets, encodePacket, OP } from './packet.ts';

/** 模拟弹幕服务器：记录收到的包，可以推送消息、主动断开 */
function fakeServer(opts: { authCode?: number } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const received: Array<{ op: number; body: string }> = [];
  const sockets: WsSocket[] = [];
  wss.on('connection', (s) => {
    sockets.push(s);
    s.on('message', (data: Buffer) => {
      for (const p of decodePackets(data)) {
        received.push({ op: p.op, body: p.body.toString() });
        if (p.op === OP.AUTH) s.send(encodePacket(OP.AUTH_REPLY, JSON.stringify({ code: opts.authCode ?? 0 })));
        if (p.op === OP.HEARTBEAT) { const b = Buffer.alloc(4); b.writeUInt32BE(1); s.send(encodePacket(OP.HEARTBEAT_REPLY, b)); }
      }
    });
  });
  const port = () => (wss.address() as { port: number }).port;
  const push = (msgs: object[]) => {
    const inner = Buffer.concat(msgs.map((m) => {
      const body = Buffer.from(JSON.stringify(m)); const h = Buffer.alloc(16);
      h.writeUInt32BE(16 + body.length, 0); h.writeUInt16BE(16, 4); h.writeUInt16BE(0, 6); h.writeUInt32BE(OP.MESSAGE, 8); h.writeUInt32BE(0, 12);
      return Buffer.concat([h, body]);
    }));
    const body = zlib.brotliCompressSync(inner); const h = Buffer.alloc(16);
    h.writeUInt32BE(16 + body.length, 0); h.writeUInt16BE(16, 4); h.writeUInt16BE(3, 6); h.writeUInt32BE(OP.MESSAGE, 8); h.writeUInt32BE(0, 12);
    for (const s of sockets) s.send(Buffer.concat([h, body]));
  };
  return { wss, received, sockets, port, push, close: () => new Promise<void>((r) => { for (const s of sockets) s.terminate(); wss.close(() => r()); }) };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('等待超时'); await new Promise((r) => setTimeout(r, 10)); }
};

let cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = []; });

function client(srv: ReturnType<typeof fakeServer>, extra: Partial<ConstructorParameters<typeof LiveClient>[0]> = {}) {
  const messages: unknown[] = []; const states: ClientState[] = []; let infoCalls = 0;
  const c = new LiveClient({
    roomId: 30000, uid: 10001, buvid: 'BUVID-TEST',
    getDanmuInfo: async () => { infoCalls++; return { token: `tok${infoCalls}`, hosts: [{ host: '127.0.0.1', wssPort: srv.port() }] }; },
    urlFor: (h) => `ws://${h.host}:${h.wssPort}/sub`,
    onMessage: (m) => messages.push(m), onState: (s) => states.push(s),
    backoffMinMs: 20, backoffMaxMs: 50, random: () => 0.5, ...extra,
  });
  cleanup.push(() => c.stop());
  return { c, messages, states, infoCalls: () => infoCalls };
}

describe('LiveClient', () => {
  it('认证包带上房间号、UID、buvid、令牌，认证成功后立即发心跳', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    const { c, states } = client(srv);
    c.start();
    await until(() => srv.received.some((p) => p.op === OP.HEARTBEAT));
    const auth = JSON.parse(srv.received.find((p) => p.op === OP.AUTH)!.body);
    expect(auth).toEqual({ uid: 10001, roomid: 30000, protover: 3, buvid: 'BUVID-TEST', platform: 'web', type: 2, key: 'tok1' });
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('收到 brotli 压缩的多条消息，逐条交给 onMessage', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    const { c, messages } = client(srv);
    c.start();
    await until(() => c.state === 'connected');
    srv.push([{ cmd: 'DANMU_MSG', info: [] }, { cmd: 'PREPARING' }]);
    await until(() => messages.length === 2);
    expect(messages.map((m) => (m as { cmd: string }).cmd)).toEqual(['DANMU_MSG', 'PREPARING']);
  });

  it('断线后自动重连，并重新获取令牌', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    const { c, states, infoCalls } = client(srv);
    c.start();
    await until(() => c.state === 'connected');
    srv.sockets[0]!.terminate();
    await until(() => srv.sockets.length === 2 && c.state === 'connected');
    expect(states).toContain('reconnecting');
    expect(infoCalls()).toBe(2);
    expect(JSON.parse(srv.received.filter((p) => p.op === OP.AUTH).at(-1)!.body).key).toBe('tok2');
  });

  it('认证失败时重试，不会停在已连接状态', async () => {
    const srv = fakeServer({ authCode: -101 }); cleanup.push(srv.close);
    const { c, states } = client(srv);
    c.start();
    await until(() => srv.sockets.length >= 2);
    expect(states).not.toContain('connected');
  });

  it('获取弹幕服务器失败时按退避时间重试', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    let fail = 2;
    const { c } = client(srv, {
      getDanmuInfo: async () => { if (fail-- > 0) throw new Error('网络错误'); return { token: 't', hosts: [{ host: '127.0.0.1', wssPort: srv.port() }] }; },
    });
    c.start();
    await until(() => c.state === 'connected');
    expect(fail).toBe(-1);
  });

  it('长时间没有数据视为断线', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    const { c } = client(srv, { idleTimeoutMs: 100, heartbeatMs: 10_000 });
    c.start();
    await until(() => srv.sockets.length >= 2);
  });

  it('电脑睡眠醒来后马上重连，不等长时间没有数据', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    let offset = 0; const warns: string[] = [];
    const { c, infoCalls } = client(srv, { wakeCheckMs: 20, now: () => Date.now() + offset, onWarn: (m) => warns.push(m) });
    c.start();
    await until(() => c.state === 'connected');
    offset += 60_000;
    await until(() => srv.sockets.length === 2 && c.state === 'connected');
    expect(infoCalls()).toBe(2);
    expect(warns.some((w) => w.includes('睡眠'))).toBe(true);
  });

  it('时间正常走时不会误判为睡眠', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    const { c } = client(srv, { wakeCheckMs: 20 });
    c.start();
    await until(() => c.state === 'connected');
    await new Promise((r) => setTimeout(r, 150));
    expect(srv.sockets.length).toBe(1);
  });

  it('stop 后不再重连', async () => {
    const srv = fakeServer(); cleanup.push(srv.close);
    const { c } = client(srv);
    c.start();
    await until(() => c.state === 'connected');
    c.stop();
    srv.sockets[0]!.terminate();
    await new Promise((r) => setTimeout(r, 150));
    expect(srv.sockets.length).toBe(1);
    expect(c.state).toBe('stopped');
  });
});
