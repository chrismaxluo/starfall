// 不连服务端也能用的页面：?check=1 兼容性自检，?loop=1 声音测试，?demo=1 轮流演示内置样式
import type { PlayItem, Position } from '@starfall/shared';
import { h } from './dom.ts';
import { checklist, detect } from './env.ts';
import type { Player } from './player.ts';

const DEMOS: Array<{ style: string; position: Position; durationMs: number; text: string; viewer: PlayItem['viewer']; gift?: PlayItem['gift'] }> = [
  { style: 'royal-gov', position: 'center', durationMs: 8000, text: '恭迎总督 长夜未央', viewer: { name: '长夜未央', guard: 1, isMod: false, medal: { name: '星临', level: 41 } } },
  { style: 'royal-adm', position: 'center', durationMs: 6000, text: '恭迎提督 月下独酌', viewer: { name: '月下独酌', guard: 2, isMod: false, medal: { name: '星临', level: 38 } } },
  { style: 'royal-cap', position: 'center', durationMs: 4000, text: '恭迎舰长 星河漫步', viewer: { name: '星河漫步', guard: 3, isMod: false, medal: { name: '星临', level: 27 } } },
  { style: 'frost', position: 'bl', durationMs: 3200, text: '晚风与你 来了', viewer: { name: '晚风与你', guard: 0, isMod: false, medal: { name: '星临', level: 27 } } },
  { style: 'line', position: 'bl', durationMs: 2400, text: '路过的猫 进入直播间', viewer: { name: '路过的猫', guard: 0, isMod: false } },
  { style: 'glass-gift', position: 'bl', durationMs: 4000, text: '半糖主义 送出 小花花', viewer: { name: '半糖主义', guard: 0, isMod: false, medal: { name: '星临', level: 8 } }, gift: { name: '小花花', count: 200, img: 'https://s1.hdslb.com/bfs/live/5126973892625f3a43a8290be6b625b5e54261a5.png' } },
  { style: 'glass-big', position: 'bl', durationMs: 6000, text: '晚风与星河漫步 送出 星愿水晶球', viewer: { name: '晚风与星河漫步', guard: 0, isMod: false }, gift: { name: '星愿水晶球', count: 1, img: 'https://s1.hdslb.com/bfs/live/f26242d5dc86bbc695336383e2ac4ba50ec033eb.png' } },
  { style: 'glass-mod', position: 'bl', durationMs: 3200, text: '青柠汽水 前来巡场', viewer: { name: '青柠汽水', guard: 0, isMod: true } },
  { style: 'glass-dm', position: 'top', durationMs: 3000, text: '路过的猫：主播晚上好！', viewer: { name: '路过的猫', guard: 0, isMod: false } },
];

let seq = 0;
export function demoItem(style: string): PlayItem {
  const d = DEMOS.find((x) => x.style === style) ?? DEMOS.find((x) => x.style === 'frost')!;
  return {
    id: `demo-${++seq}`,
    kind: 'enter',
    effect: { id: 0, name: d.style, visual: { type: 'builtin_style', style: d.style }, showText: true, position: d.position, durationMs: d.durationMs, fadeIn: false, fadeOut: false, fadeInMs: 500, fadeOutMs: 500, offsetX: 0, offsetY: 0, sizePct: 100, featherPct: 0, guardFrame: false, honorBadge: false, sound: null, volume: 70 },
    text: d.text,
    viewer: d.viewer,
    ...(d.gift ? { gift: d.gift } : {}),
    test: true,
  };
}

export const DEMO_STYLES = DEMOS.map((d) => d.style);

/** 本地测试音（不需要音频文件） */
let ctx: AudioContext | null = null;
export function beep(): string {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new C();
    if (ctx.state === 'suspended') void ctx.resume();
    [1318, 1760].forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.12;
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.7);
    });
    return ctx.state;
  } catch {
    return '不可用';
  }
}

export function showCheck(stage: HTMLElement, player: Player, canvas: string): void {
  const icons = { ok: '✓', mid: '!', bad: '✕' };
  const env = detect();
  const list = h('ul');
  for (const [name, value, level] of checklist(env, canvas)) list.append(h('li', {}, h('i', { class: level }, icons[level]), h('b', {}, name), h('span', {}, value)));
  const play = h('button', {}, '播放测试音 + 舰长特效');
  const close = h('button', { class: 'sec' }, '关闭');
  const panel = h(
    'div',
    { class: 'check' },
    h('div', { class: 'check-card' }, h('h2', {}, '兼容性自检'), h('div', { class: 'sub' }, '在 OBS 或直播姬里用浏览器源打开这个页面，就能看到当前环境支持哪些特效能力。'), list, h('div', { class: 'ua' }, `UA：${navigator.userAgent}`), h('div', { class: 'actions' }, play, close)),
  );
  play.onclick = () => {
    panel.hidden = true;
    beep();
    player.play(demoItem('frost'));
  };
  close.onclick = () => (panel.hidden = true);
  stage.append(panel);
}

/** 声音测试：每 8 秒播放一次测试音和舰长特效，并显示音频状态 */
export function startLoop(stage: HTMLElement, player: Player): void {
  const badge = h('div', { class: 'loop-badge' });
  stage.append(badge);
  let n = 0;
  const tick = () => {
    const st = beep();
    n++;
    const ok = st === 'running';
    badge.replaceChildren(`声音测试 #${n} · 音频状态：`, h('b', { style: { color: ok ? '#3DD68C' : '#F0B45A' } }, ok ? '正在播放' : st === 'suspended' ? '被拦截（需要点击）' : st));
    player.play(demoItem('frost'));
  };
  tick();
  setInterval(tick, 8000);
}

/** 轮流播放全部内置样式 */
export function startDemo(player: Player, only?: string): void {
  const styles = only ? [only] : DEMO_STYLES;
  let i = 0;
  const next = () => {
    const item = demoItem(styles[i++ % styles.length]!);
    player.play(item);
    setTimeout(next, item.effect.durationMs + 600);
  };
  next();
}
