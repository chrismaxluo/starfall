import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_CLOSE, OVERLAY_TIMING } from '@starfall/shared/overlay';
import { connect } from './conn.ts';

/** 假的 WebSocket：记录创建过的连接，由测试控制打开、收消息、关闭 */
class FakeWs {
  static OPEN = 1;
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  closedByClient = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeWs.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closedByClient = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  msg(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWs.all = [];
  vi.stubGlobal('WebSocket', FakeWs);
  vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' });
  vi.stubGlobal('addEventListener', () => undefined);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const handlers = () => ({ onMessage: vi.fn(), onFatal: vi.fn(), onState: vi.fn() });

describe('特效页连接', () => {
  it('收到心跳就保持连接；太久没有任何消息时主动断开并重连', () => {
    const h = handlers();
    const c = connect('ws://x', h);
    const first = FakeWs.all[0]!;
    first.open();
    for (let t = 0; t < 3 * OVERLAY_TIMING.deadMs; t += OVERLAY_TIMING.pingMs) {
      vi.advanceTimersByTime(OVERLAY_TIMING.pingMs);
      first.msg({ type: 'ping' });
    }
    expect(FakeWs.all).toHaveLength(1);

    // 网络悄悄断了：不再有消息，也没有关闭事件
    vi.advanceTimersByTime(OVERLAY_TIMING.deadMs + 5000);
    expect(first.closedByClient).toBe(true);
    expect(h.onState).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(1000);
    expect(FakeWs.all).toHaveLength(2);
    // 旧连接之后才触发的关闭事件不影响新连接
    first.onclose?.({ code: 1006 });
    FakeWs.all[1]!.open();
    expect(h.onState).toHaveBeenLastCalledWith(true);
    c.close();
  });

  it('连上后定时报平安', () => {
    const c = connect('ws://x', handlers());
    const ws = FakeWs.all[0]!;
    ws.open();
    vi.advanceTimersByTime(OVERLAY_TIMING.aliveMs * 2);
    expect(ws.sent.filter((d) => JSON.parse(d).type === 'alive')).toHaveLength(2);
    c.close();
  });

  it('断线后按退避时间重连；密钥失效时不再重连', () => {
    const h = handlers();
    const c = connect('ws://x', h);
    FakeWs.all[0]!.open();
    FakeWs.all[0]!.serverClose(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWs.all).toHaveLength(2);
    FakeWs.all[1]!.serverClose(OVERLAY_CLOSE.badKey);
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(2);
    expect(h.onFatal).toHaveBeenCalledOnce();
    c.close();
  });
});
