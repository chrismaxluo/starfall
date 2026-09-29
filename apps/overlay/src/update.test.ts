import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_MS, RETRY_MS, autoUpdate } from './update.ts';

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('特效页自动更新', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('版本一样、没有版本时不刷新', () => {
    const reload = vi.fn();
    autoUpdate('index-a.js', () => false, reload, new MemStore())('index-a.js');
    autoUpdate(null, () => false, reload, new MemStore())('index-b.js');
    autoUpdate('index-a.js', () => false, reload, new MemStore())(null);
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('等特效播完、空闲一会儿再刷新', () => {
    const reload = vi.fn();
    let busy = true;
    autoUpdate('index-a.js', () => busy, reload, new MemStore())('index-b.js');
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
    busy = false;
    vi.advanceTimersByTime(IDLE_MS - 500);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('刚为同一个版本刷新过还是旧的：一段时间内不再刷新', () => {
    const store = new MemStore();
    const reload = vi.fn();
    autoUpdate('index-a.js', () => false, reload, store)('index-b.js');
    vi.advanceTimersByTime(IDLE_MS + 1000);
    expect(reload).toHaveBeenCalledTimes(1);
    // 刷新后（新页面）拿到的还是旧版本
    const reload2 = vi.fn();
    autoUpdate('index-a.js', () => false, reload2, store)('index-b.js');
    vi.advanceTimersByTime(IDLE_MS + 1000);
    expect(reload2).not.toHaveBeenCalled();
    // 又有更新的版本：照常刷新；过了 RETRY_MS 也会再试
    autoUpdate('index-a.js', () => false, reload2, store)('index-c.js');
    vi.advanceTimersByTime(IDLE_MS + 1000);
    expect(reload2).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RETRY_MS);
    const reload3 = vi.fn();
    autoUpdate('index-a.js', () => false, reload3, store)('index-c.js');
    vi.advanceTimersByTime(IDLE_MS + 1000);
    expect(reload3).toHaveBeenCalledTimes(1);
  });
});
