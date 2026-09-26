import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePackets, encodePacket, OP } from './packet.ts';

describe('数据包编解码', () => {
  it('编码后能原样解码', () => {
    const [p] = decodePackets(encodePacket(OP.AUTH, '{"a":1}'));
    expect(p).toMatchObject({ op: OP.AUTH, ver: 1 });
    expect(p!.body.toString()).toBe('{"a":1}');
  });

  it('包头 16 字节：总长度、包头长度、版本、操作码、序号', () => {
    const b = encodePacket(OP.HEARTBEAT, 'x');
    expect([b.readUInt32BE(0), b.readUInt16BE(4), b.readUInt16BE(6), b.readUInt32BE(8), b.readUInt32BE(12)]).toEqual([17, 16, 1, 2, 1]);
  });

  const inner = (s: string) => {
    const body = Buffer.from(s);
    const h = Buffer.alloc(16);
    h.writeUInt32BE(16 + body.length, 0); h.writeUInt16BE(16, 4); h.writeUInt16BE(0, 6); h.writeUInt32BE(OP.MESSAGE, 8); h.writeUInt32BE(0, 12);
    return Buffer.concat([h, body]);
  };
  const outer = (ver: number, body: Buffer) => {
    const h = Buffer.alloc(16);
    h.writeUInt32BE(16 + body.length, 0); h.writeUInt16BE(16, 4); h.writeUInt16BE(ver, 6); h.writeUInt32BE(OP.MESSAGE, 8); h.writeUInt32BE(0, 12);
    return Buffer.concat([h, body]);
  };

  it('版本 3（brotli）解压后得到多条消息', () => {
    const packed = outer(3, zlib.brotliCompressSync(Buffer.concat([inner('{"cmd":"A"}'), inner('{"cmd":"B"}')])));
    expect(decodePackets(packed).map((p) => p.body.toString())).toEqual(['{"cmd":"A"}', '{"cmd":"B"}']);
  });

  it('版本 2（zlib）同样支持', () => {
    expect(decodePackets(outer(2, zlib.deflateSync(inner('{"cmd":"Z"}'))))[0]!.body.toString()).toBe('{"cmd":"Z"}');
  });

  it('一个消息里的多个包、以及末尾不完整的包', () => {
    const buf = Buffer.concat([inner('1'), inner('2'), inner('3').subarray(0, 10)]);
    expect(decodePackets(buf).map((p) => p.body.toString())).toEqual(['1', '2']);
  });

  it('长度为 0 的包不会原地打转；解压失败的包跳过，其余照常解析', () => {
    const zero = Buffer.alloc(32);
    const bad = { count: 0 };
    expect(decodePackets(zero, bad)).toEqual([]);
    expect(bad.count).toBe(1);

    const good = outer(3, zlib.brotliCompressSync(inner('{"cmd":"OK"}')));
    const broken = outer(2, Buffer.from('not zlib'));
    const bad2 = { count: 0 };
    const out = decodePackets(Buffer.concat([broken, good]), bad2);
    expect(out.map((p) => p.body.toString())).toEqual(['{"cmd":"OK"}']);
    expect(bad2.count).toBe(1);
    // 解压后内容里含长度为 0 的包
    expect(decodePackets(outer(2, zlib.deflateSync(Buffer.alloc(40))))).toEqual([]);
  });
});
