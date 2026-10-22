import { describe, expect, it } from 'vitest';
import { CHAT_LOOK_ALPHA } from '@starfall/shared/overlay';
import { BUB_PAD, actKeyframes, bubbleSvg, fxSprites, frostMaskSvg, geo, hachiHead, nameIcon, ornament, pickCat, pixelize, themeFrame, twinkles } from './chat-theme-art.ts';
import type { InPath, ThemeLook, Tier } from './chat-theme-art.ts';

const LOOKS: ThemeLook[] = ['jelly', 'porcelain', 'cream', 'night', 'pixel'];
const TIERS: Tier[] = ['n', 3, 2, 1, 'anchor'];
/** 测试里不用画布：随便判断一下（只要能跑通、不出 NaN） */
const fakeIn: InPath = () => (x, y) => (x + y) % 7 < 3;

describe('弹幕列表主题外观：小八表情和小动作', () => {
  it('按弹幕内容挑，先对上的先用；表情包配抱爱心', () => {
    expect(pickCat('哈哈哈哈笑死', false, 0)).toMatchObject({ id: 'laughing', act: 'shake' });
    expect(pickCat('哈哈', false, 0).id).toBe('grin');
    expect(pickCat('呜呜呜', false, 0)).toMatchObject({ id: 'crying', act: 'shiver' });
    expect(pickCat('卧槽！', false, 0)).toMatchObject({ id: 'shocked', act: 'jump' });
    expect(pickCat('无语……', false, 0).id).toBe('exhausted');
    expect(pickCat('晚安', false, 0)).toMatchObject({ id: 'sleepy', act: 'nod' });
    expect(pickCat('这是什么？', false, 0).id).toBe('puzzled');
    expect(pickCat('', true, 0)).toEqual({ id: 'heart', act: 'pulse', fallback: false });
  });
  it('都对不上的轮流用开心、眨眼、眯眼', () => {
    expect([0, 1, 2, 3].map((i) => pickCat('666', false, i).id)).toEqual(['happy', 'wink', 'content', 'happy']);
    expect(pickCat('666', false, 0).fallback).toBe(true);
  });
  it('小动作的关键帧从 0 到 1，没有的动作退回跳一下', () => {
    for (const name of ['shake', 'jump', 'nod', 'nope']) {
      const [kf, dur] = actKeyframes(name);
      expect(kf[0]!.offset).toBe(0);
      expect(kf[kf.length - 1]!.offset).toBe(1);
      expect(dur).toBeGreaterThan(300);
    }
  });
});

describe('弹幕列表主题外观：图形', () => {
  it('五种外观、五种身份、两种字号的气泡和头像框都能画，没有 NaN', () => {
    for (const look of LOOKS) for (const tier of TIERS) for (const k of [1, 1.2]) {
      const bub = bubbleSvg(look, 420, 98 * k, k, tier, CHAT_LOOK_ALPHA[look] / 100, false, fakeIn);
      expect(bub).toMatch(/^<svg /);
      expect(bub).not.toContain('NaN');
      expect(themeFrame(look, tier, fakeIn)).not.toContain('NaN');
      expect(frostMaskSvg(look, 420, 98, k, false)).not.toContain('NaN');
    }
    // 奶油贴纸的格子花边：右上是两只格子猫耳（有格子图案），小八风没有
    expect(bubbleSvg('cream', 420, 98, 1, 'n', 0.6, true, fakeIn)).toMatch(/fill="url\(#c\d+g\)"/);
    expect(bubbleSvg('cream', 420, 98, 1, 'n', 0.6, false, fakeIn)).not.toMatch(/fill="url\(#c\d+g\)"/);
  });
  it('气泡底色的浓淡写进图里', () => {
    expect(bubbleSvg('cream', 420, 98, 1, 'n', 0.6, false, fakeIn)).toContain('fill-opacity="0.6"');
    expect(bubbleSvg('pixel', 420, 98, 1, 'n', 0.35, false, fakeIn)).toContain('fill-opacity="0.35"');
  });
  it('头像框按身份换色', () => {
    expect(themeFrame('night', 2, fakeIn)).toContain('#A57CFF');
    expect(themeFrame('pixel', 1, fakeIn)).toContain('#F0A925');
    expect(themeFrame('jelly', 1, fakeIn)).toContain('#FFD772');
    expect(themeFrame('porcelain', 1, fakeIn)).toContain('#D4AF55');
    expect(themeFrame('cream', 'anchor', fakeIn)).toContain('#F49AB8');
  });
  it('小八头顶：耳朵从气泡上沿长出来，最后回到右上圆角开始的地方', () => {
    const x1 = 500, y0 = 46, R = 42, H = hachiHead(x1, y0, R, 1);
    expect(H.seg.startsWith('L')).toBe(true);
    expect(H.seg.endsWith(`${x1 - R},${y0}`)).toBe(true);
    // 蓝色在左半截不往下超过文字上方（上沿往下 12）
    const ys = [...H.cap.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].filter((m) => +m[1]! < x1 - 64).map((m) => +m[2]!);
    expect(Math.max(...ys)).toBeLessThanOrEqual(y0 + 12);
  });
  it('身份装饰、小星星、昵称前的小图标', () => {
    expect(ornament('pixel', 'crown').px).toBe(true);
    expect(ornament('night', 'star').px).toBe(false);
    expect(nameIcon('jelly')).toBeNull();
    expect(nameIcon('porcelain')).not.toBeNull();
    expect(twinkles('cream', false)).toEqual([]);
    expect(twinkles('night', false).map((t) => t[0])).toEqual(['t1', 't2']);
    expect(twinkles('night', true).map((t) => t[0])).toEqual(['t1']);
    for (const look of LOOKS) expect(fxSprites(look, 'gold').length).toBeGreaterThan(0);
  });
  it('小八平时坐在头像右下角（放右边时在左下角），进场时放大到框中间', () => {
    const l = geo(1, false, false), r = geo(1, false, true);
    expect(l.ccx).toBeGreaterThan(l.hx);
    expect(r.ccx).toBeLessThan(r.hx);
    expect(l.big).toBeGreaterThan(l.sts);
    expect(geo(1.2, false, false).F).toBeCloseTo(l.F * 1.2);
    expect(BUB_PAD.pixel).toEqual([0, 0]);
  });
});

describe('像素小八', () => {
  it('发灰的白边算白，透明的保持透明，旁边描一格深色边', () => {
    // 3×1：透明、灰白、透明
    const px = new Uint8ClampedArray([0, 0, 0, 0, 230, 232, 236, 255, 0, 0, 0, 0]);
    pixelize(px, 3, 1);
    expect([...px.slice(4, 8)]).toEqual([255, 255, 255, 255]);
    expect([...px.slice(0, 4)]).toEqual([20, 25, 58, 255]);
  });
});
