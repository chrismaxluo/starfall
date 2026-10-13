// 点歌窗口：从封面取两种颜色（主色、辅色），各个样子拿来做柔光、描边、渐变。
// 按色相分 12 格，饱和度高、不太暗不太亮的像素权重大；主色是最重的一格，辅色是离主色至少 60° 里最重的一格（没有就把主色转 40°）。
// 封面太素（黑白、灰）时用星辉靛和粉紫。

export interface Tint {
  /** "r, g, b"，用在 rgba(var(--tint), .5)：放在深色底上 */
  c1: string;
  c2: string;
  /** 同样的颜色调深：放在白色、纸色底上（白昼、手帐） */
  d1: string;
  d2: string;
}

export const DEFAULT_TINT: Tint = { c1: '139, 140, 255', c2: '224, 122, 181', d1: '84, 81, 214', d2: '196, 72, 140' };

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `${Math.round(f(0) * 255)}, ${Math.round(f(8) * 255)}, ${Math.round(f(4) * 255)}`;
}

/** data 是 RGBA 像素（canvas 的 getImageData） */
export function tintFromPixels(data: ArrayLike<number>): Tint {
  const bins = Array.from({ length: 12 }, () => ({ w: 0, s: 0, h: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if ((data[i + 3] ?? 255) < 128) continue;
    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!);
    const w = s * s * (l > 0.12 && l < 0.92 ? 1 : 0.1);
    total += 1;
    if (w < 0.02) continue;
    const b = bins[Math.floor(h / 30) % 12]!;
    b.w += w;
    b.s += s * w;
    b.h += h * w;
  }
  const order = bins.map((b, i) => ({ ...b, i })).sort((a, b) => b.w - a.w);
  const top = order[0]!;
  // 有颜色的像素太少：封面基本是黑白灰
  if (!total || top.w / total < 0.04) return DEFAULT_TINT;
  const hue1 = top.h / top.w;
  const sat1 = Math.max(0.55, Math.min(0.9, top.s / top.w));
  const far = order.find((b) => b.w > top.w * 0.12 && Math.min(Math.abs(b.i - top.i), 12 - Math.abs(b.i - top.i)) >= 2);
  const hue2 = far ? far.h / far.w : (hue1 + 40) % 360;
  const sat2 = far ? Math.max(0.5, Math.min(0.9, far.s / far.w)) : sat1;
  // 亮度固定：浅的放在深色底上看得清、又不发白；深的放在白底上看得清
  return { c1: hslToRgb(hue1, sat1, 0.66), c2: hslToRgb(hue2, sat2, 0.7), d1: hslToRgb(hue1, Math.min(0.75, sat1), 0.44), d2: hslToRgb(hue2, Math.min(0.75, sat2), 0.48) };
}

const cache = new Map<string, Tint>();

/** 读封面取色（封面要允许跨域读取；读不了时用默认色） */
export function tintOf(url: string, done: (t: Tint) => void): void {
  const hit = cache.get(url);
  if (hit) return done(hit);
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.referrerPolicy = 'no-referrer';
  im.onload = () => {
    let t = DEFAULT_TINT;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(im, 0, 0, 16, 16);
      t = tintFromPixels(g.getImageData(0, 0, 16, 16).data);
    } catch {
      /* 跨域读不了 */
    }
    cache.set(url, t);
    done(t);
  };
  im.onerror = () => done(DEFAULT_TINT);
  im.src = url;
}
