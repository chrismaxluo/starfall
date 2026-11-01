import { describe, expect, it } from 'vitest';
import { placeWindow, trayStatus, zoomStep } from './ui.ts';

const MAIN = { x: 0, y: 0, width: 1920, height: 1040 };
const SIDE = { x: 1920, y: 0, width: 1920, height: 1040 };
const LAPTOP = { x: 0, y: 0, width: 1366, height: 728 };

describe('窗口放在哪', () => {
  it('第一次打开：默认大小放在主屏中间；笔记本小屏幕按屏幕缩小，也放得下', () => {
    expect(placeWindow(undefined, [MAIN], MAIN)).toEqual({ bounds: { x: 280, y: 80, width: 1360, height: 880 }, maximized: false, minWidth: 960, minHeight: 640 });
    const small = placeWindow(undefined, [LAPTOP], LAPTOP);
    expect(small.bounds.width).toBeLessThanOrEqual(1366);
    expect(small.bounds.height).toBeLessThanOrEqual(728);
    const tiny = { x: 0, y: 0, width: 1024, height: 536 };
    expect(placeWindow(undefined, [tiny], tiny)).toMatchObject({ minWidth: 960, minHeight: 536 });
  });
  it('回到上次的位置、大小、最大化，副屏上的也是', () => {
    const saved = { x: 2100, y: 60, width: 1200, height: 800, maximized: true };
    expect(placeWindow(saved, [MAIN, SIDE], MAIN)).toMatchObject({ bounds: { x: 2100, y: 60, width: 1200, height: 800 }, maximized: true });
  });
  it('副屏拔掉了：回到主屏中间，不会跑到看不见的地方', () => {
    const saved = { x: 2100, y: 60, width: 1200, height: 800, maximized: false };
    expect(placeWindow(saved, [MAIN], MAIN).bounds).toEqual({ x: 280, y: 80, width: 1360, height: 880 });
  });
  it('换到小屏幕：缩到放得下，拉回屏幕里', () => {
    const saved = { x: 300, y: 200, width: 1700, height: 1000, maximized: false };
    expect(placeWindow(saved, [LAPTOP], LAPTOP).bounds).toEqual({ x: 0, y: 0, width: 1366, height: 728 });
  });
});

describe('托盘上的状态', () => {
  const ok = { paused: false, overlays: 1, room: { roomId: 1 }, account: { loggedIn: true, expiresAt: 2e12 }, live: { live: true, connection: 'connected', loginInvalid: false } };
  it('一句话说现在怎么样', () => {
    expect(trayStatus(ok, 1e12).text).toBe('星临 · 直播中，一切正常');
    expect(trayStatus({ ...ok, paused: true }, 1e12).text).toBe('星临 · 特效已暂停');
    expect(trayStatus({ ...ok, overlays: 0 }, 1e12).text).toBe('星临 · 直播中，特效页没连上');
    expect(trayStatus({ ...ok, live: { live: true, connection: 'reconnecting' } }, 1e12).text).toBe('星临 · 直播中，正在重连直播间');
    expect(trayStatus({ ...ok, live: { live: false } }, 1e12).text).toBe('星临 · 未开播，开播后自动连接');
    expect(trayStatus(null, 1e12).problem).toBeNull();
  });
  it('B站登录失效、过期、没登录：要提醒；没设置直播间时不算', () => {
    expect(trayStatus({ ...ok, live: { live: true, connection: 'connected', loginInvalid: true } }, 1e12).problem?.key).toBe('login');
    expect(trayStatus({ ...ok, account: { loggedIn: true, expiresAt: 1 } }, 1e12).problem?.key).toBe('login');
    expect(trayStatus({ ...ok, account: { loggedIn: false } }, 1e12).problem?.key).toBe('login');
    expect(trayStatus({ ...ok, room: null, account: { loggedIn: false }, live: { live: false } }, 1e12)).toEqual({ text: '星临 · 还没设置直播间', problem: null });
  });
});

describe('缩放快捷键', () => {
  it('Ctrl 加号放大、减号缩小、0 回到原样', () => {
    expect(zoomStep('=')).toBe(0.5);
    expect(zoomStep('+')).toBe(0.5);
    expect(zoomStep('-')).toBe(-0.5);
    expect(zoomStep('0')).toBe(0);
    expect(zoomStep('a')).toBeNull();
  });
});
