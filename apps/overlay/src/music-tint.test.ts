import { describe, expect, it } from 'vitest';
import { DEFAULT_TINT, tintFromPixels } from './music-tint.ts';

/** 一组像素：每种颜色重复 n 个 */
const px = (...parts: Array<[number, number, number, number]>) => parts.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat());
const hueOf = (rgb: string) => {
  const [r, g, b] = rgb.split(',').map((x) => Number(x) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return -1;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe('封面取色', () => {
  it('主色是最多的那种颜色，辅色是另一种差得远的颜色', () => {
    const t = tintFromPixels(px([220, 40, 40, 150], [40, 80, 220, 80], [30, 30, 30, 26]));
    expect(hueOf(t.c1)).toBeLessThan(20);
    expect(hueOf(t.c2)).toBeGreaterThan(200);
    expect(hueOf(t.c2)).toBeLessThan(250);
  });

  it('只有一种颜色：辅色把主色转一点；黑白灰的封面用默认色', () => {
    const t = tintFromPixels(px([40, 200, 80, 256]));
    expect(Math.abs(hueOf(t.c2) - hueOf(t.c1) - 40)).toBeLessThan(6);
    expect(tintFromPixels(px([250, 250, 250, 128], [20, 20, 20, 128]))).toEqual(DEFAULT_TINT);
    expect(tintFromPixels([])).toEqual(DEFAULT_TINT);
  });
});
