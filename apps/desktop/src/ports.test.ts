import { describe, expect, it } from 'vitest';
import { fixText, HOME_PORT, planPorts } from './ports.ts';
import { findStreamApp } from './stream-apps.ts';

/** 除了 busy 里的都能用 */
const free = (...busy: number[]) => async (p: number) => !busy.includes(p);

describe('选端口', () => {
  it('第一次用 17520', async () => {
    expect(await planPorts([], free())).toEqual({ port: HOME_PORT, extra: [], used: [HOME_PORT] });
  });

  it('17520 被占用：往后找空的，记下来', async () => {
    expect(await planPorts([HOME_PORT], free(HOME_PORT, HOME_PORT + 1))).toEqual({ port: HOME_PORT + 2, extra: [], used: [HOME_PORT + 2, HOME_PORT] });
  });

  it('换过端口以后：回到 17520，换过的端口也同时开着（直播软件里填哪个都能连上）', async () => {
    expect(await planPorts([HOME_PORT + 2, HOME_PORT], free())).toEqual({ port: HOME_PORT, extra: [HOME_PORT + 2], used: [HOME_PORT, HOME_PORT + 2] });
  });

  it('17520 又被占用：优先用以前换过的端口', async () => {
    expect(await planPorts([HOME_PORT, HOME_PORT + 2], free(HOME_PORT))).toEqual({ port: HOME_PORT + 2, extra: [], used: [HOME_PORT + 2, HOME_PORT] });
  });

  it('旧版本记的端口不是 17520：也同时开着', async () => {
    expect(await planPorts([HOME_PORT + 1], free())).toEqual({ port: HOME_PORT, extra: [HOME_PORT + 1], used: [HOME_PORT, HOME_PORT + 1] });
  });

  it('最多记 4 个；全都被占用时报错', async () => {
    const r = await planPorts([1, 2, 3, 4], free());
    expect(r.used).toEqual([HOME_PORT, 1, 2, 3]);
    await expect(planPorts([], async () => false)).rejects.toThrow('都被占用了');
  });

  it('怎么办的说明：端口变了让换地址，没变让刷新', () => {
    expect(fixText('直播姬', HOME_PORT)).toBe('在直播姬里右键特效源，点「刷新」。（先开直播软件、后开星临时会这样）');
    expect(fixText('OBS', HOME_PORT + 1)).toContain(`改用 ${HOME_PORT + 1}`);
  });
});

describe('认出直播软件', () => {
  const list = (...names: string[]) => names.map((n, i) => `"${n}","${100 + i}","Console","1","12,345 K"`).join('\r\n');

  it('按程序名认，不分大小写', () => {
    expect(findStreamApp(list('System', 'explorer.exe', 'livehime.exe'))).toBe('直播姬');
    expect(findStreamApp(list('OBS64.EXE'))).toBe('OBS');
  });

  it('都没开、输出是空的或是提示文字时为 null', () => {
    expect(findStreamApp(list('chrome.exe', 'Starfall.exe'))).toBeNull();
    expect(findStreamApp('')).toBeNull();
    expect(findStreamApp('信息: 没有运行的任务匹配指定标准。')).toBeNull();
  });
});
