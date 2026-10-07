import { describe, expect, it, vi } from 'vitest';
import type { BiliHttp, GiftConfig, GiftEffectFile, GiftEffectLayout } from '@starfall/bili';
import { GiftEffects } from './gift-fx.ts';

const LAYOUT: GiftEffectLayout = { w: 720, h: 1280, videoW: 1088, videoH: 1280, rgb: [0, 0, 720, 1280], alpha: [724, 0, 360, 640], durationMs: 5700 };
const car: GiftConfig = { id: 32089, name: '极速超跑', price: 100_000, paid: true, icon: 'car.png', effectId: 699 };
const flower: GiftConfig = { id: 31036, name: '小花花', price: 100, paid: true, icon: 'f.png' };
const flush = () => new Promise((r) => setTimeout(r, 0));

function make(opts: { list?: () => Promise<Map<number, GiftEffectFile>>; layout?: () => Promise<GiftEffectLayout> } = {}) {
  const fetchList = vi.fn(opts.list ?? (async () => new Map([[699, { mp4: 'https://i0.hdslb.com/car.mp4', json: 'https://i0.hdslb.com/car.json' }]])));
  const fetchLayout = vi.fn(opts.layout ?? (async () => LAYOUT));
  return { fx: new GiftEffects(() => ({}) as BiliHttp, fetchList, fetchLayout), fetchList, fetchLayout };
}

describe('B站礼物全屏动画', () => {
  it('启动时读动画列表，并把礼物面板上有动画的礼物提前读好；没有动画的礼物为空', async () => {
    const { fx, fetchLayout } = make();
    fx.start(async () => [car, flower]);
    await flush();
    await flush();
    expect(fx.forGift(car)).toEqual({ fx: { src: 'https://i0.hdslb.com/car.mp4', w: 720, h: 1280, videoW: 1088, videoH: 1280, rgb: [0, 0, 720, 1280], alpha: [724, 0, 360, 640] }, durationMs: 5700 });
    expect(fx.forGift(flower)).toBeUndefined();
    expect(fx.forGift(undefined)).toBeUndefined();
    expect(fetchLayout).toHaveBeenCalledTimes(1);
  });

  it('没启动（测试、还没联网）时只查内存，不去 B 站读', async () => {
    const { fx, fetchList } = make();
    expect(fx.forGift(car)).toBeUndefined();
    await fx.ready(car);
    expect(fetchList).not.toHaveBeenCalled();
  });

  it('第一次用到时在后台读，下一次就有；读失败时 10 分钟内不再重试', async () => {
    let fail = true;
    const { fx, fetchLayout } = make({ layout: async () => { if (fail) throw new Error('x'); return LAYOUT; } });
    fx.start(async () => []);
    await flush();
    expect(fx.forGift(car)).toBeUndefined();
    await flush();
    fail = false;
    expect(fx.forGift(car)).toBeUndefined();
    expect(fetchLayout).toHaveBeenCalledTimes(1);
    // 预览时可以等它读好（不受重试间隔限制）
    await fx.ready(car);
    expect(fx.forGift(car)?.durationMs).toBe(5700);
  });
});
