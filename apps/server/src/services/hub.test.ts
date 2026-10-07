import { describe, expect, it } from 'vitest';
import { Hub } from './hub.ts';
import type { OutputRow } from './outputs.ts';

const output = { id: 1, name: '竖屏直播' } as OutputRow;
const sock = () => ({ send: () => undefined, close: () => undefined });

describe('在线的特效页', () => {
  it('浏览器查看页、弹幕列表不算加到了直播软件', () => {
    const hub = new Hub();
    hub.addOverlay(sock(), output, [], 0, 'fx', true);
    hub.addOverlay(sock(), output, [], 0, 'chat');
    expect(hub.overlayCount()).toBe(0);
    const real = hub.addOverlay(sock(), output, [], 0, 'fx');
    expect(hub.overlayCount()).toBe(1);
    expect(hub.overlayList().map((x) => [x.role, x.view])).toEqual([['fx', true], ['chat', false], ['fx', false]]);
    hub.removeOverlay(real);
    expect(hub.overlayCount()).toBe(0);
  });

  it('旧版特效页只在上报的环境里写 view，也不算', () => {
    const hub = new Hub();
    const c = hub.addOverlay(sock(), output, [], 0, 'fx');
    expect(hub.overlayCount()).toBe(1);
    hub.report(c, { env: { view: true } });
    expect(hub.overlayCount()).toBe(0);
  });
});
