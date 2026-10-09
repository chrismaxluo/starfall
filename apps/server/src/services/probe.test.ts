import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import protobuf from 'protobufjs';
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURES } from '../testing.ts';
import { ALLOWED, probe, sniff } from './probe.ts';

const file = (n: string) => path.join(FIXTURES, 'media', n);
const head = (n: string) => fs.readFileSync(file(n)).subarray(0, 64);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-probe-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
const tmp = (name: string, content: Buffer | string) => {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
};

describe('按文件头识别真实类型', () => {
  it('真实文件通过', () => {
    expect(sniff('webm', head('alpha.webm'))).toBe(true);
    expect(sniff('mp4', head('opaque.mp4'))).toBe(true);
    expect(sniff('png', head('still.png'))).toBe(true);
    expect(sniff('wav', head('beep.wav'))).toBe(true);
    expect(sniff('json', Buffer.from('  {"v":"5"}'))).toBe(true);
    expect(sniff('gif', Buffer.from('GIF89a......'))).toBe(true);
    expect(sniff('jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(true);
    expect(sniff('webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);
    expect(sniff('ogg', Buffer.from('OggS\0\0\0\0'))).toBe(true);
    expect(sniff('mp3', Buffer.from('ID3\x04\0\0\0\0'))).toBe(true);
    expect(sniff('svga', zlib.deflateSync(Buffer.from('x')))).toBe(true);
  });

  it('改过扩展名的文件不通过', () => {
    const exe = Buffer.from('MZ\x90\0\x03\0\0\0\x04\0\0\0\xff\xff\0\0');
    for (const ext of Object.keys(ALLOWED)) expect(sniff(ext, exe), ext).toBe(false);
    expect(sniff('webm', head('opaque.mp4'))).toBe(false);
    expect(sniff('wav', head('alpha.webm'))).toBe(false);
    expect(sniff('exe', exe)).toBe(false);
  });
});

describe('读取视频、图片、音频的尺寸、时长、透明通道', () => {
  const info = (n: string) => probe(file(n), ALLOWED[path.extname(n).slice(1)]!);
  it('WebM：时长取容器上的值，识别 alpha_mode；边录边写（没写时长）的按最后一帧算', async () => {
    expect(await info('alpha.webm')).toEqual({ width: 64, height: 96, durationMs: 1200, hasAlpha: true });
    expect(await info('live.webm')).toEqual({ width: 48, height: 32, durationMs: 500, hasAlpha: true });
  });
  it('MP4 没有透明通道；分片的 MP4（例如 OBS 的分片录像）把每段加起来', async () => {
    expect(await info('opaque.mp4')).toEqual({ width: 64, height: 96, durationMs: 1000, hasAlpha: false });
    expect(await info('frag.mp4')).toEqual({ width: 48, height: 32, durationMs: 500, hasAlpha: false });
  });
  it('图片：静态的没有时长，动图把每帧的间隔加起来', async () => {
    expect(await info('still.png')).toEqual({ width: 40, height: 30, durationMs: null, hasAlpha: true });
    expect(await info('still.jpg')).toEqual({ width: 48, height: 32, durationMs: null, hasAlpha: false });
    expect(await info('alpha.webp')).toEqual({ width: 48, height: 32, durationMs: null, hasAlpha: true });
    expect(await info('anim.gif')).toEqual({ width: 48, height: 32, durationMs: 300, hasAlpha: true });
    expect(await info('anim.apng')).toEqual({ width: 48, height: 32, durationMs: 300, hasAlpha: true });
    expect(await info('anim.webp')).toEqual({ width: 48, height: 32, durationMs: 300, hasAlpha: false });
  });
  it('PNG：有 tRNS 块才算透明；GIF 小于 0.02 秒的间隔按 0.1 秒算', async () => {
    const chunk = (type: string, data: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, data.length]), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
    const png = (colorType: number, trns: boolean) => {
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(7, 0);
      ihdr.writeUInt32BE(5, 4);
      ihdr[8] = 8;
      ihdr[9] = colorType;
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), trns ? chunk('tRNS', Buffer.alloc(6)) : Buffer.alloc(0), chunk('IEND', Buffer.alloc(0))]);
    };
    expect((await probe(tmp('rgb.png', png(2, false)), ALLOWED.png!)).hasAlpha).toBe(false);
    expect((await probe(tmp('rgb-trns.png', png(2, true)), ALLOWED.png!)).hasAlpha).toBe(true);
    expect((await probe(tmp('pal.png', png(3, false)), ALLOWED.png!)).hasAlpha).toBe(false);
    const frame = Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 7, 0, 5, 0, 0, 2, 0]);
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([7, 0, 5, 0, 0, 0, 0]), frame, frame, Buffer.from([0x3b])]);
    expect(await probe(tmp('fast.gif', gif), ALLOWED.gif!)).toEqual({ width: 7, height: 5, durationMs: 200, hasAlpha: true });
  });
  it('音频只有时长：MP3 没有 Xing 标签时一帧一帧数；Opus 去掉开头的预留采样', async () => {
    expect(await info('beep.wav')).toEqual({ width: null, height: null, durationMs: 300, hasAlpha: false });
    expect(await info('tone.mp3')).toEqual({ width: null, height: null, durationMs: 627, hasAlpha: false });
    expect(await info('tone.ogg')).toEqual({ width: null, height: null, durationMs: 600, hasAlpha: false });
  });
  it('结构不对的文件直接拒绝', async () => {
    await expect(probe(tmp('no-moov.mp4', fs.readFileSync(file('opaque.mp4')).subarray(0, 40)), ALLOWED.mp4!)).rejects.toThrow();
    await expect(probe(tmp('cut.webm', fs.readFileSync(file('alpha.webm')).subarray(0, 30)), ALLOWED.webm!)).rejects.toThrow();
    await expect(probe(tmp('cut.gif', Buffer.from('GIF89a\x07\0\x05\0\0\0\0\x2c', 'latin1')), ALLOWED.gif!)).rejects.toThrow();
    await expect(probe(tmp('noise.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0x12, 0x34])), ALLOWED.jpg!)).rejects.toThrow();
  });
});

describe('SVGA、Lottie 读取自身的元数据', () => {
  it('SVGA 2.x：画布尺寸，帧数 ÷ 帧率 = 时长', async () => {
    const root = protobuf.Root.fromJSON({
      nested: {
        P: { fields: { viewBoxWidth: { type: 'float', id: 1 }, viewBoxHeight: { type: 'float', id: 2 }, fps: { type: 'int32', id: 3 }, frames: { type: 'int32', id: 4 } } },
        M: { fields: { version: { type: 'string', id: 1 }, params: { type: 'P', id: 2 } } },
      },
    });
    const M = root.lookupType('M');
    const buf = zlib.deflateSync(M.encode(M.create({ version: '2.0', params: { viewBoxWidth: 750, viewBoxHeight: 1334, fps: 20, frames: 60 } })).finish());
    expect(await probe(tmp('a.svga', buf), ALLOWED.svga!)).toEqual({ width: 750, height: 1334, durationMs: 3000, hasAlpha: true, slots: [] });
  });

  it('SVGA：读出可以替换的图层和原图大小（2.x 和 1.x）', async () => {
    const two = await probe(path.join(FIXTURES, 'media/slots.svga'), ALLOWED.svga!);
    expect(two).toMatchObject({ width: 640, height: 180, durationMs: 2000 });
    expect(two.slots).toEqual([{ key: 'deco', w: 50, h: 50 }, { key: 'avatar', w: 100, h: 100 }, { key: 'frame', w: 140, h: 140 }, { key: 'badge', w: 48, h: 48 }, { key: 'nickname', w: 300, h: 60 }, { key: 'welcome', w: 400, h: 40 }]);
    const one = await probe(path.join(FIXTURES, 'media/slots-v1.svga'), ALLOWED.svga!);
    expect(one).toMatchObject({ width: 640, height: 180, durationMs: 2000 });
    expect(one.slots).toEqual([{ key: 'head', w: 100, h: 100 }, { key: 'nick', w: 300, h: 60 }, { key: 'deco', w: 50, h: 50 }]);
  });

  it('SVGA 压缩炸弹（解压后超过 64 MB）直接拒绝，不会把内存撑爆', async () => {
    const bomb = zlib.deflateSync(Buffer.alloc(80 * 1024 * 1024), { level: 9 });
    expect(bomb.length).toBeLessThan(200 * 1024);
    await expect(probe(tmp('bomb.svga', bomb), ALLOWED.svga!)).rejects.toThrow('太大');
  });

  it('内容不是 MP3 的 .mp3（例如播放列表）直接拒绝', async () => {
    const fake = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), Buffer.from('#EXTM3U\n#EXTINF:1,\n/etc/hostname\n')]);
    await expect(probe(tmp('list.mp3', fake), ALLOWED.mp3!)).rejects.toThrow();
  });

  it('Lottie：w、h，(op - ip) ÷ fr = 时长；不是动画文件时报错', async () => {
    expect(await probe(tmp('a.json', JSON.stringify({ v: '5.7', w: 512, h: 512, fr: 30, ip: 0, op: 90, layers: [] })), ALLOWED.json!)).toEqual({ width: 512, height: 512, durationMs: 3000, hasAlpha: true });
    await expect(probe(tmp('b.json', '{"hello":1}'), ALLOWED.json!)).rejects.toThrow('Lottie');
  });
});
