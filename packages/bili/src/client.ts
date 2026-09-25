// 直播间 WebSocket 客户端：连接、认证、心跳、断线重连（需求 F-BL-04 ~ 05，方案设计 7.3）。
// 只负责把原始消息交给 onMessage；解析由 parse.ts 完成，是否播放由服务端决定。
import type { DanmuInfo } from './api.ts';
import { encodePacket, decodePackets, OP } from './packet.ts';

export type ClientState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface LiveClientOptions {
  roomId: number;
  /** 登录账号的 UID（未登录为 0） */
  uid: number;
  buvid: string;
  /** 获取弹幕服务器信息；每次重连都会重新获取令牌 */
  getDanmuInfo: () => Promise<DanmuInfo>;
  onMessage: (raw: { cmd?: string; [k: string]: unknown }) => void;
  onState?: (state: ClientState, detail?: string) => void;
  /** 测试用：替换连接地址 */
  urlFor?: (host: { host: string; wssPort: number }) => string;
  heartbeatMs?: number;
  /** 超过这个时间没有收到任何数据，视为断线 */
  idleTimeoutMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** 测试用：替换随机数（重连抖动） */
  random?: () => number;
}

export class LiveClient {
  private readonly o: Required<Omit<LiveClientOptions, 'onState' | 'urlFor' | 'random'>> & Pick<LiveClientOptions, 'onState' | 'urlFor'> & { random: () => number };
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private hostIndex = 0;
  private _state: ClientState = 'idle';

  constructor(opts: LiveClientOptions) {
    this.o = {
      heartbeatMs: 30_000,
      idleTimeoutMs: 70_000,
      backoffMinMs: 1000,
      backoffMaxMs: 30_000,
      random: Math.random,
      ...opts,
    };
  }

  get state(): ClientState {
    return this._state;
  }

  /** 是否已停止（用方法读取，避免 TypeScript 在 await 之后误判状态不会变化） */
  private isStopped(): boolean {
    return this._state === 'stopped';
  }

  start(): void {
    if (this._state !== 'idle' && this._state !== 'stopped') return;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.setState('stopped');
    this.cleanup();
  }

  private setState(s: ClientState, detail?: string): void {
    this._state = s;
    this.o.onState?.(s, detail);
  }

  private cleanup(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.heartbeat = this.idleTimer = this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* 已关闭 */
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.isStopped()) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let info: DanmuInfo;
    try {
      info = await this.o.getDanmuInfo();
    } catch (e) {
      return this.scheduleRetry(`获取弹幕服务器失败：${(e as Error).message}`);
    }
    if (this.isStopped()) return;
    const host = info.hosts[this.hostIndex % info.hosts.length]!;
    const url = this.o.urlFor ? this.o.urlFor(host) : `wss://${host.host}:${host.wssPort}/sub`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      ws.send(encodePacket(OP.AUTH, JSON.stringify({ uid: this.o.uid, roomid: this.o.roomId, protover: 3, buvid: this.o.buvid, platform: 'web', type: 2, key: info.token })));
      this.touch();
    };
    ws.onmessage = (e) => {
      this.touch();
      for (const p of decodePackets(Buffer.from(e.data as ArrayBuffer))) {
        if (p.op === OP.AUTH_REPLY) this.onAuth(p.body.toString());
        else if (p.op === OP.MESSAGE) {
          let raw: { cmd?: string };
          try {
            raw = JSON.parse(p.body.toString('utf8'));
          } catch {
            continue;
          }
          try {
            this.o.onMessage(raw);
          } catch {
            /* 单条消息处理出错不影响连接 */
          }
        }
      }
    };
    ws.onclose = () => this.onDisconnect('连接断开');
    ws.onerror = () => this.onDisconnect('连接出错');
  }

  private onAuth(body: string): void {
    let code = -1;
    try {
      code = (JSON.parse(body) as { code?: number }).code ?? -1;
    } catch {
      /* 保持 -1 */
    }
    if (code !== 0) return this.onDisconnect(`认证失败（code ${code}）`);
    this.attempt = 0;
    this.setState('connected');
    if (this.heartbeat) clearInterval(this.heartbeat);
    const beat = () => this.ws?.readyState === WebSocket.OPEN && this.ws.send(encodePacket(OP.HEARTBEAT, '[object Object]'));
    beat();
    this.heartbeat = setInterval(beat, this.o.heartbeatMs);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.onDisconnect('长时间没有收到数据'), this.o.idleTimeoutMs);
  }

  private onDisconnect(reason: string): void {
    if (this.isStopped()) return;
    this.cleanup();
    this.hostIndex++; // 下次换一个服务器
    this.scheduleRetry(reason);
  }

  private scheduleRetry(reason: string): void {
    if (this.isStopped()) return;
    const base = Math.min(this.o.backoffMaxMs, this.o.backoffMinMs * 2 ** this.attempt);
    const delay = Math.round(base * (0.8 + 0.4 * this.o.random()));
    this.attempt++;
    this.setState('reconnecting', `${reason}，${Math.round(delay / 1000)} 秒后重连`);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
}
