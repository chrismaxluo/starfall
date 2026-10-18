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

  it('双语写在一起（同一个时间两行）：第一行原文、最后一行翻译；日文歌夹着的罗马音不要', () => {
    const lrc = '[00:10.00]I wanna hold your hand\n[00:10.00]我想牵你的手\n[00:15.00]君が好き\n[00:15.00]kimi ga suki\n[00:15.00]我喜欢你\n[00:20.00]la la la\n[00:20.00]la la la';
    expect(parseLrc(lrc)).toEqual([
      { t: 10_000, text: 'I wanna hold your hand', tr: '我想牵你的手' },
      { t: 15_000, text: '君が好き', tr: '我喜欢你' },
      { t: 20_000, text: 'la la la' },
    ]);
  });

  it('翻译和原文的时间差半秒以内也配得上（网易云偶尔差几毫秒），配最近的那句', () => {
    const lrc = '[00:10.00]one\n[00:10.30]two\n[00:20.00]three';
    const tr = '[00:10.01]一\n[00:10.29]二\n[00:21.00]三';
    expect(parseLrc(lrc, tr)).toEqual([
      { t: 10_000, text: 'one', tr: '一' },
      { t: 10_300, text: 'two', tr: '二' },
      { t: 20_000, text: 'three' },
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
