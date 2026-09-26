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

/**
 * 拆包。不会抛出异常：长度不对的包（包括长度为 0，否则会原地打转）直接丢掉剩下的部分；
 * 解压失败的包跳过，其余照常处理。bad 用来统计丢掉的包。
 */
export function decodePackets(buf: Buffer, bad: { count: number } = { count: 0 }, depth = 0): Packet[] {
  const out: Packet[] = [];
  let off = 0;
  while (off + 16 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const headLen = buf.readUInt16BE(off + 4);
    const ver = buf.readUInt16BE(off + 6);
    const op = buf.readUInt32BE(off + 8);
    if (headLen < 16 || len < headLen || off + len > buf.length) {
      bad.count++;
      break;
    }
    const body = buf.subarray(off + headLen, off + len);
    off += len;
    if (op === OP.MESSAGE && (ver === 2 || ver === 3) && depth < 2) {
      let inner: Buffer;
      try {
        inner = ver === 2 ? zlib.inflateSync(body) : zlib.brotliDecompressSync(body);
      } catch {
        bad.count++;
        continue;
      }
      out.push(...decodePackets(inner, bad, depth + 1));
    } else out.push({ op, ver, body });
  }
  return out;
}
