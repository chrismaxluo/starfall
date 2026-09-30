// 生成 SVGA 文件（2.x：zlib 压缩的 protobuf；1.x：zip 里放 movie.spec 和图片）。
// 用来做测试样本和星临自己的 SVGA 特效。字段和官方播放器 svgaplayerweb 一致。
import { createRequire } from 'node:module';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(path.resolve(import.meta.dirname, '../../../apps/server/package.json'));
const protobuf = require('protobufjs');

const root = protobuf.Root.fromJSON({
  nested: {
    MovieParams: { fields: { viewBoxWidth: { type: 'float', id: 1 }, viewBoxHeight: { type: 'float', id: 2 }, fps: { type: 'int32', id: 3 }, frames: { type: 'int32', id: 4 } } },
    Layout: { fields: { x: { type: 'float', id: 1 }, y: { type: 'float', id: 2 }, width: { type: 'float', id: 3 }, height: { type: 'float', id: 4 } } },
    Transform: { fields: { a: { type: 'float', id: 1 }, b: { type: 'float', id: 2 }, c: { type: 'float', id: 3 }, d: { type: 'float', id: 4 }, tx: { type: 'float', id: 5 }, ty: { type: 'float', id: 6 } } },
    FrameEntity: { fields: { alpha: { type: 'float', id: 1 }, layout: { type: 'Layout', id: 2 }, transform: { type: 'Transform', id: 3 }, clipPath: { type: 'string', id: 4 } } },
    SpriteEntity: { fields: { imageKey: { type: 'string', id: 1 }, frames: { rule: 'repeated', type: 'FrameEntity', id: 2 }, matteKey: { type: 'string', id: 3 } } },
    MovieEntity: { fields: { version: { type: 'string', id: 1 }, params: { type: 'MovieParams', id: 2 }, images: { keyType: 'string', type: 'bytes', id: 3 }, sprites: { rule: 'repeated', type: 'SpriteEntity', id: 4 } } },
  },
});
const Movie = root.lookupType('MovieEntity');

/**
 * movie: { width, height, fps, frames, images: { key: Buffer(PNG) }, sprites: [{ imageKey, matteKey?, frames: [{ alpha, layout, transform, clipPath? }] }] }
 * 不可见的帧写成 {}（alpha 为 0）
 */
export function encodeSvga2(movie) {
  const msg = Movie.fromObject({
    version: '2.0.0',
    params: { viewBoxWidth: movie.width, viewBoxHeight: movie.height, fps: movie.fps, frames: movie.frames },
    images: movie.images,
    sprites: movie.sprites,
  });
  return zlib.deflateSync(Buffer.from(Movie.encode(msg).finish()), { level: 9 });
}

/** 1.x 格式：zip（movie.spec + 图片），用 yazl 打包 */
export async function encodeSvga1(movie) {
  const yazl = require('yazl');
  const zip = new yazl.ZipFile();
  const images = {};
  for (const [k, buf] of Object.entries(movie.images)) { images[k] = k; zip.addBuffer(buf, `${k}.png`); }
  const spec = { ver: '1.1.0', movie: { viewBox: { width: movie.width, height: movie.height }, fps: movie.fps, frames: movie.frames }, images, sprites: movie.sprites };
  zip.addBuffer(Buffer.from(JSON.stringify(spec)), 'movie.spec');
  zip.end();
  const chunks = [];
  for await (const c of zip.outputStream) chunks.push(c);
  return Buffer.concat(chunks);
}

/* ---------- 最小的 PNG 编码（RGBA），做测试图片用 ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
/** pixel(x, y) → [r, g, b, a] */
export function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b, a] = pixel(x, y); const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * 一帧：播放器按 transform 摆放图层（layout 只给宽高，位置写在 tx、ty 里，和 AE 导出的一样）。
 * x、y 是左上角，scale、rotate（弧度）绕图层中心
 */
export function frame({ x, y, width, height, alpha = 1, scale = 1, rotate = 0 }) {
  if (alpha <= 0) return {};
  const cx = width / 2, cy = height / 2, c = Math.cos(rotate) * scale, s = Math.sin(rotate) * scale;
  return { alpha, layout: { x: 0, y: 0, width, height }, transform: { a: c, b: s, c: -s, d: c, tx: x + cx - (c * cx - s * cy), ty: y + cy - (s * cx + c * cy) } };
}

/** 一个图层在所有帧里固定不动（可以指定每一帧的透明度） */
export function still(frames, layout, alpha = () => 1) {
  return Array.from({ length: frames }, (_, i) => frame({ ...layout, alpha: alpha(i) }));
}
