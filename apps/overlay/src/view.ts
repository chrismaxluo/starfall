// 浏览器查看模式（地址加 &view=1）：用普通浏览器打开真实的特效页时，透明背景会显示成一片白，看不出有没有在工作。
// 这个模式下：深色格子背景、画出安全区、顶部显示连接状态和正在播放的特效。和直播画面收到的是同一份消息。
// 只在带 view=1 时启用，不做自动判断——判断错了会让直播画面盖上一层背景。
import type { OverlayConfig, OverlayToServer, PlayItem } from '@starfall/shared/overlay';
import { h } from './dom.ts';

export const VIEW_BAR = 44;

type ConnState = 'connecting' | 'online' | 'offline' | 'invalid';

export interface ViewBar {
  setConn(s: ConnState): void;
  setConfig(c: OverlayConfig): void;
  onPlay(item: PlayItem): void;
  /** 播放器发给服务端的消息（开始 / 结束 / 出错） */
  onPlayer(m: OverlayToServer): void;
}

export function startView(): ViewBar {
  document.documentElement.classList.add('view');
  const dot = h('i', { class: 'vb-dot' });
  const connText = h('span');
  const canvas = h('span', { class: 'vb-mute' });
  const now = h('span', { class: 'vb-now' }, '空闲，等待特效');
  const count = h('span', { class: 'vb-mute' });
  const sound = h('button', { class: 'vb-sound' });
  sound.type = 'button';
  const bar = h(
    'div',
    { class: 'vbar' },
    h('b', {}, '星临特效页 · 浏览器查看'),
    h('span', { class: 'vb-conn' }, dot, connText),
    canvas,
    now,
    count,
    sound,
  );
  bar.title = '这个页面只用来查看效果。直播软件里请使用不带 view=1 的地址（透明背景）';
  document.body.append(bar);

  // 浏览器要求用户点过页面才允许有声音的播放
  const activated = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false;
  const renderSound = () => {
    const on = activated();
    sound.textContent = on ? '声音已开启' : '点这里开启声音';
    sound.classList.toggle('on', on);
  };
  renderSound();
  addEventListener('pointerdown', () => setTimeout(renderSound, 0), { capture: true });

  let received = 0;
  let playing: string | null = null;
  const names = new Map<string, string>();
  const idle = () => {
    playing = null;
    now.textContent = '空闲，等待特效';
    now.classList.remove('on');
  };

  return {
    setConn(s) {
      dot.className = `vb-dot ${s}`;
      connText.textContent = { connecting: '连接中…', online: '已连接', offline: '连接断开，正在重连', invalid: '地址已失效' }[s];
    },
    setConfig(c) {
      canvas.textContent = `${c.name} · ${c.width}×${c.height} ${c.orient === 'portrait' ? '竖屏' : '横屏'}`;
    },
    onPlay(item) {
      received++;
      count.textContent = `本页已收到 ${received} 个`;
      names.set(item.id, `${item.effect.name} · ${item.viewer.name}`);
      // 只需要记住最近的几条（长时间开着不累积）
      if (names.size > 20) names.delete(names.keys().next().value!);
      playing = item.id;
      now.textContent = `正在播放：${names.get(item.id)}`;
      now.classList.add('on');
    },
    onPlayer(m) {
      if (m.type === 'ended' && m.id === playing) idle();
      if (m.type === 'error') {
        now.textContent = `出错：${m.message}`;
        now.classList.remove('on');
        renderSound();
      }
    },
  };
}
