import { describe, expect, it } from 'vitest';
import { lyricIndex, parseLrc } from './music.ts';

describe('歌词', () => {
  it('解析 LRC：去掉说明行和空行，一行多个时间拆开，按时间排好，配上翻译', () => {
    const lrc = '[00:00.000] 作词 : 米果\n[00:01.000] 作曲 : 高橋優\n[00:25.237]这一路上走走停停\n[00:28.59]顺着少年漂流的痕迹\n[00:30.00]\n[01:00.5][00:20]重复的一句\n没有时间的一行';
    const tr = '[00:25.237]翻译一\n[00:28.59]顺着少年漂流的痕迹';
    expect(parseLrc(lrc, tr)).toEqual([
      { t: 20_000, text: '重复的一句' },
      { t: 25_237, text: '这一路上走走停停', tr: '翻译一' },
      { t: 28_590, text: '顺着少年漂流的痕迹' },
      { t: 60_500, text: '重复的一句' },
    ]);
  });

  it('现在唱到第几句', () => {
    const lines = [{ t: 1000, text: 'a' }, { t: 2000, text: 'b' }, { t: 3000, text: 'c' }];
    expect(lyricIndex(lines, 500)).toBe(-1);
    expect(lyricIndex(lines, 1000)).toBe(0);
    expect(lyricIndex(lines, 2999)).toBe(1);
    expect(lyricIndex(lines, 99_000)).toBe(2);
    expect(lyricIndex([], 1)).toBe(-1);
  });
});
