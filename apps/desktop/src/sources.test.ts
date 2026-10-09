import { describe, expect, it } from 'vitest';
import { downloadSources, MIRRORS, normalizeMirror, sourceName, SpeedWatch, viaMirror } from './sources.ts';

describe('下载来源', () => {
  it('先直连 GitHub，再试自己填的，最后是内置加速站；重复的去掉', () => {
    expect(downloadSources()).toEqual([null, ...MIRRORS]);
    expect(downloadSources('https://my.proxy/')).toEqual([null, 'https://my.proxy/', ...MIRRORS]);
    expect(downloadSources(MIRRORS[2])).toEqual([null, MIRRORS[2], ...MIRRORS.filter((m) => m !== MIRRORS[2])]);
  });

  it('自己填的地址：空的为不用，补上末尾的 /，不是网址的不收', () => {
    expect(normalizeMirror('  ')).toBeNull();
    expect(normalizeMirror(' https://ghfast.top ')).toBe('https://ghfast.top/');
    expect(normalizeMirror('https://x.cn/gh/')).toBe('https://x.cn/gh/');
    expect(normalizeMirror('ghfast.top')).toBeUndefined();
    expect(normalizeMirror('ftp://x.cn/')).toBeUndefined();
    expect(normalizeMirror('https://x.cn/?u=')).toBeUndefined();
  });

  it('加速站地址放在 GitHub 地址前面；名字给人看', () => {
    const u = 'https://github.com/o/r/releases/download/v1.6.0/Starfall-1.6.0-win-x64-setup.exe';
    expect(viaMirror(u, null)).toBe(u);
    expect(viaMirror(u, 'https://gh-proxy.com/')).toBe(`https://gh-proxy.com/${u}`);
    expect(new URL(viaMirror(u, 'https://gh-proxy.com/')).pathname).toBe(`/${u}`);
    expect(sourceName(null)).toBe('GitHub 直连');
    expect(sourceName('https://gh-proxy.com/')).toBe('备用地址 gh-proxy.com');
  });
});

describe('测速', () => {
  it('不满 15 秒不判断；之后最近 15 秒平均每秒不到 200KB 算太慢', () => {
    const w = new SpeedWatch(0);
    expect(w.tooSlow(14_000)).toBe(false);
    // 一直没有进度
    expect(w.tooSlow(15_000)).toBe(true);
    const fast = new SpeedWatch(0);
    for (let t = 1000; t <= 20_000; t += 1000) fast.progress((t / 1000) * 500 * 1024, t);
    expect(fast.tooSlow(20_000)).toBe(false);
    const slow = new SpeedWatch(0);
    for (let t = 1000; t <= 20_000; t += 1000) slow.progress((t / 1000) * 100 * 1024, t);
    expect(slow.tooSlow(20_000)).toBe(true);
  });

  it('一开始快、后来卡住也算太慢', () => {
    const w = new SpeedWatch(0);
    for (let t = 1000; t <= 10_000; t += 1000) w.progress((t / 1000) * 1024 * 1024, t);
    expect(w.tooSlow(20_000)).toBe(false);
    expect(w.tooSlow(26_000)).toBe(true);
  });
});
