import { describe, expect, it } from 'vitest';
import { fitSize } from './media.ts';
import { textWithoutName, thumb } from './parts.ts';
import { DEFAULT_CONFIG, metrics } from './stage.ts';

describe('画布尺寸', () => {
  it('竖屏 1080×1920：缩放 1，安全区换算成像素', () => {
    expect(metrics(DEFAULT_CONFIG)).toEqual({ width: 1080, height: 1920, fxz: 1, safeTop: 230.4, safeBottom: 768, marginX: 97.2 });
  });
  it('小画布按短边缩小；横屏 1920×1080 不放大；整体缩放叠加', () => {
    expect(metrics({ ...DEFAULT_CONFIG, width: 720, height: 1280 }).fxz).toBeCloseTo(0.667, 3);
    expect(metrics({ ...DEFAULT_CONFIG, width: 1920, height: 1080 }).fxz).toBe(1);
    expect(metrics({ ...DEFAULT_CONFIG, scale: 150 }).fxz).toBe(1.5);
  });
});

describe('素材显示尺寸', () => {
  it('保持比例放进区域', () => {
    expect(fitSize({ width: 750, height: 1334 }, { w: 1080, h: 1920 }, Infinity)).toEqual({ w: 1079, h: 1920 });
    expect(fitSize({ width: 1920, height: 1080 }, { w: 1080, h: 1920 }, Infinity)).toEqual({ w: 1080, h: 608 });
  });
  it('角落位置不超过整体缩放倍数', () => {
    expect(fitSize({ width: 200, height: 100 }, { w: 800, h: 800 }, 1)).toEqual({ w: 200, h: 100 });
  });
  it('没有尺寸信息时占满区域', () => {
    expect(fitSize({ width: null, height: null }, { w: 500, h: 400 }, 1)).toEqual({ w: 500, h: 400 });
  });
});

describe('欢迎语', () => {
  it('去掉昵称后的文字（星冕把昵称单独放大）', () => {
    expect(textWithoutName('总督 长夜未央 驾临', '长夜未央')).toBe('总督 驾临');
    expect(textWithoutName('长夜未央', '长夜未央')).toBe('');
    expect(textWithoutName('欢迎回来', '')).toBe('欢迎回来');
  });
});

describe('头像缩略图', () => {
  it('B 站头像按 2 倍像素取缩略图（32 的倍数，最大 512）；其他地址、已经带参数的原样返回', () => {
    expect(thumb('https://i0.hdslb.com/bfs/face/a.jpg', 72)).toBe('https://i0.hdslb.com/bfs/face/a.jpg@160w_160h.webp');
    expect(thumb('https://i2.hdslb.com/bfs/face/a.jpg', 400)).toBe('https://i2.hdslb.com/bfs/face/a.jpg@512w_512h.webp');
    expect(thumb('https://i0.hdslb.com/bfs/face/a.jpg@100w.webp', 72)).toBe('https://i0.hdslb.com/bfs/face/a.jpg@100w.webp');
    expect(thumb('https://example.invalid/a.jpg', 72)).toBe('https://example.invalid/a.jpg');
  });
});
