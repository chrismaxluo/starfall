// P0 技术验证：连接 B 站直播间，抓取原始消息样本。
// 用法：node spike/capture.ts [房间号] [秒数]
// 不传房间号时自动选一个当前人气最高的直播间。样本写入 spike/captures/（不进 git，含他人信息）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const jar: Record<string, string> = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://live.bilibili.com/', Origin: 'https://live.bilibili.com', Cookie: cookie() } });
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`非 JSON 响应 ${res.status}: ${text.slice(0, 80)}`); }
}

// ---- WBI 签名 ----
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
async function wbiKey(): Promise<string> {
  const nav = await getJson('https://api.bilibili.com/x/web-interface/nav');
  const stem = (u: string) => u.slice(u.lastIndexOf('/') + 1).split('.')[0];
  const raw = stem(nav.data.wbi_img.img_url) + stem(nav.data.wbi_img.sub_url);
  return MIXIN.map((i) => raw[i]).join('').slice(0, 32);
}
function sign(params: Record<string, string | number>, key: string): string {
  const all: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) };
  const q = Object.keys(all).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${q}&w_rid=${crypto.createHash('md5').update(q + key).digest('hex')}`;
}

// ---- 数据包 ----
const OP = { HEARTBEAT: 2, HEARTBEAT_REPLY: 3, MESSAGE: 5, AUTH: 7, AUTH_REPLY: 8 } as const;
function pack(op: number, body: string): Buffer {
  const b = Buffer.from(body);
  const h = Buffer.alloc(16);
  h.writeUInt32BE(16 + b.length, 0); h.writeUInt16BE(16, 4); h.writeUInt16BE(1, 6); h.writeUInt32BE(op, 8); h.writeUInt32BE(1, 12);
  return Buffer.concat([h, b]);
}
function* unpack(buf: Buffer): Generator<{ op: number; ver: number; body: Buffer }> {
  let off = 0;
  while (off + 16 <= buf.length) {
    const len = buf.readUInt32BE(off), hlen = buf.readUInt16BE(off + 4), ver = buf.readUInt16BE(off + 6), op = buf.readUInt32BE(off + 8);
    const body = buf.subarray(off + hlen, off + len);
    if (op === OP.MESSAGE && ver === 2) yield* unpack(zlib.inflateSync(body));
    else if (op === OP.MESSAGE && ver === 3) yield* unpack(zlib.brotliDecompressSync(body));
    else yield { op, ver, body };
    off += len;
  }
}

async function pickRoom(): Promise<number> {
  const r = await getJson('https://api.live.bilibili.com/room/v1/Area/getListByAreaID?areaId=0&sort=online&pageSize=5&page=1');
  return r.data[0].roomid;
}

async function main() {
  const seconds = Number(process.argv[3] || 120);
  // 有登录信息（spike/login.ts 保存的）就带上，否则匿名连接
  const accountFile = path.join(import.meta.dirname, '../data/bili-account.json');
  let uid = 0;
  if (fs.existsSync(accountFile)) {
    Object.assign(jar, JSON.parse(fs.readFileSync(accountFile, 'utf8')).cookies);
    uid = Number(jar.DedeUserID) || 0;
    console.log(`使用已登录的账号 UID ${uid}`);
  } else console.log('未登录，匿名连接（昵称会被打码）');
  const spi = await getJson('https://api.bilibili.com/x/frontend/finger/spi');
  jar.buvid3 ||= spi.data.b_3; jar.buvid4 ||= spi.data.b_4;
  const input = Number(process.argv[2]) || (await pickRoom());
  const init = await getJson(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${input}`);
  const roomId: number = init.data.room_id;
  console.log(`房间 ${input} → 长号 ${roomId}，主播 UID ${init.data.uid}，开播状态 ${init.data.live_status}`);

  const key = await wbiKey();
  const info = await getJson(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${sign({ id: roomId, type: 0, web_location: '444.8' }, key)}`);
  if (info.code !== 0) throw new Error(`getDanmuInfo 失败：${info.code} ${info.message}`);
  const host = info.data.host_list[0];
  console.log(`弹幕服务器 ${host.host}:${host.wss_port}，服务器数量 ${info.data.host_list.length}`);

  const outDir = path.join(import.meta.dirname, 'captures');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${roomId}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const out = fs.createWriteStream(outFile);
  const counts: Record<string, number> = {};

  const ws = new WebSocket(`wss://${host.host}:${host.wss_port}/sub`);
  ws.binaryType = 'arraybuffer';
  let hb: NodeJS.Timeout | undefined;
  ws.onopen = () => {
    ws.send(pack(OP.AUTH, JSON.stringify({ uid, roomid: roomId, protover: 3, buvid: jar.buvid3, platform: 'web', type: 2, key: info.data.token })));
    hb = setInterval(() => ws.send(pack(OP.HEARTBEAT, '[object Object]')), 30_000);
  };
  ws.onmessage = (e) => {
    for (const p of unpack(Buffer.from(e.data as ArrayBuffer))) {
      if (p.op === OP.AUTH_REPLY) console.log('认证结果：', p.body.toString());
      else if (p.op === OP.HEARTBEAT_REPLY) counts['(心跳回复)'] = (counts['(心跳回复)'] || 0) + 1;
      else if (p.op === OP.MESSAGE) {
        const text = p.body.toString('utf8');
        let cmd = '(无法解析)';
        try { cmd = JSON.parse(text).cmd; } catch {}
        counts[cmd] = (counts[cmd] || 0) + 1;
        out.write(JSON.stringify({ t: Date.now(), ver: p.ver, raw: text }) + '\n');
      }
    }
  };
  ws.onclose = (e) => console.log('连接关闭：', e.code, e.reason);
  ws.onerror = (e) => console.log('连接错误：', (e as ErrorEvent).message);

  setTimeout(() => {
    clearInterval(hb); ws.close(); out.end();
    console.log(`\n${seconds} 秒内收到的消息类型（共 ${Object.values(counts).reduce((a, b) => a + b, 0)} 条）：`);
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), k);
    console.log(`\n样本已保存：${path.relative(process.cwd(), outFile)}`);
  }, seconds * 1000);
}

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
