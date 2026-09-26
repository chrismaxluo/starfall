// 弹幕服务器数据包：16 字节包头 + 正文；版本 2 为 zlib 压缩、版本 3 为 brotli 压缩，解压后是若干个版本 0 的包。
import zlib from 'node:zlib';

export const OP = { HEARTBEAT: 2, HEARTBEAT_REPLY: 3, MESSAGE: 5, AUTH: 7, AUTH_REPLY: 8 } as const;

export function encodePacket(op: number, body: string | Buffer): Buffer {
  const b = typeof body === 'string' ? Buffer.from(body) : body;
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16 + b.length, 0);
  head.writeUInt16BE(16, 4);
  head.writeUInt16BE(1, 6);
  head.writeUInt32BE(op, 8);
  head.writeUInt32BE(1, 12);
  return Buffer.concat([head, b]);
}

export interface Packet {
  op: number;
  ver: number;
  body: Buffer;
}

export function decodePackets(buf: Buffer): Packet[] {
  const out: Packet[] = [];
  let off = 0;
  while (off + 16 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const headLen = buf.readUInt16BE(off + 4);
    const ver = buf.readUInt16BE(off + 6);
    const op = buf.readUInt32BE(off + 8);
    if (len < headLen || off + len > buf.length) break; // 不完整的包直接丢弃
    const body = buf.subarray(off + headLen, off + len);
    if (op === OP.MESSAGE && ver === 2) out.push(...decodePackets(zlib.inflateSync(body)));
    else if (op === OP.MESSAGE && ver === 3) out.push(...decodePackets(zlib.brotliDecompressSync(body)));
    else out.push({ op, ver, body });
    off += len;
  }
  return out;
}
