// 星临特效页：作为浏览器源放进 B站直播姬 / OBS。地址形如 /overlay/?output=1&key=...
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/600.css';
import '@fontsource/noto-sans-sc/700.css';
import './style.css';
import type { OverlayConfig, ServerToOverlay } from '@starfall/shared';
import { connect } from './conn.ts';
import type { Conn } from './conn.ts';
import { showCheck, startDemo, startLoop } from './demo.ts';
import { h } from './dom.ts';
import { detect } from './env.ts';
import { Player } from './player.ts';
import { DEFAULT_CONFIG, applyConfig, fit, metrics, setViewInset, showSafeAreas } from './stage.ts';
import { VIEW_BAR, startView } from './view.ts';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const env = detect();

let config: OverlayConfig = { ...DEFAULT_CONFIG };
// 不连服务端时（自检、演示）可以用参数模拟画布
if (q.get('o') === 'landscape') config = { ...config, orient: 'landscape', width: 1920, height: 1080, safeTop: 0, safeBottom: 0, marginX: 3 };
if (Number(q.get('w')) && Number(q.get('h'))) config = { ...config, width: Number(q.get('w')), height: Number(q.get('h')) };

// 浏览器查看模式（&view=1）：深色背景、安全区、顶部状态栏
const view = q.get('view') === '1' && q.get('preview') !== '1' ? startView() : null;
if (view) setViewInset(VIEW_BAR);
const showSafe = q.get('debug') === '1' || view !== null;

const lite = () => q.get('lite') === '1' || config.liteMode === 'on' || (config.liteMode === 'auto' && !env.blur);
const apply = () => applyConfig(stage, config, lite());
apply();
addEventListener('resize', () => fit(stage, config));
if (showSafe) showSafeAreas(stage);

let conn: Conn | null = null;
const player = new Player(stage, () => metrics(config), (m) => {
  conn?.send(m);
  view?.onPlayer(m);
});

function notice(title: string, detail: string): void {
  stage.querySelector('.notice')?.remove();
  stage.append(h('div', { class: 'notice' }, title, h('small', {}, detail)));
}

/** 预加载本输出会用到的文件（逐个下载，避免直播时抢带宽） */
async function preload(urls: string[]): Promise<void> {
  for (const u of urls) await fetch(u).then((r) => r.blob()).catch(() => undefined);
}

function onMessage(m: ServerToOverlay): void {
  switch (m.type) {
    case 'hello':
      config = m.config;
      apply();
      stage.querySelector('.notice')?.remove();
      view?.setConfig(config);
      conn?.send({ type: 'report', env: { ...detect(), lite: lite(), canvas: `${config.width}×${config.height}`, ...(view ? { view: true } : {}) } });
      void preload(m.preload);
      break;
    case 'config':
      config = m.config;
      apply();
      stage.querySelectorAll('.safe').forEach((el) => el.remove());
      if (showSafe) showSafeAreas(stage);
      break;
    case 'preload':
      void preload(m.preload);
      break;
    case 'play':
      player.play(m.item);
      view?.onPlay(m.item);
      break;
    case 'stop':
      player.stop();
      break;
  }
}

// 预览模式（管理后台里的 iframe）：只接收同源页面发来的消息，只在本地播放，不连服务端
const preview = q.get('preview') === '1';
if (preview) {
  addEventListener('message', (e: MessageEvent<ServerToOverlay | { type: 'config'; config: OverlayConfig }>) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    onMessage(e.data as ServerToOverlay);
  });
  parent.postMessage({ type: 'starfall-preview-ready' }, location.origin);
}

const output = q.get('output');
const key = q.get('key');
const offline = preview || q.get('check') === '1' || q.get('loop') === '1' || q.has('demo');

if (output && key) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/overlay?output=${encodeURIComponent(output)}&key=${encodeURIComponent(key)}`;
  view?.setConn('connecting');
  conn = connect(url, {
    onMessage,
    onState: (online) => view?.setConn(online ? 'online' : 'offline'),
    onFatal: () => {
      view?.setConn('invalid');
      notice('特效页地址已失效', '可能是重置了密钥或删除了这个输出，请在星临管理后台「直播软件输出」重新复制地址');
    },
  });
} else if (!offline) {
  notice('这是星临特效页', '请在管理后台「直播软件输出」复制完整地址（带 output 和 key）粘贴到浏览器源');
}

const canvas = `${config.width}×${config.height}`;
if (q.get('check') === '1') showCheck(stage, player, canvas);
if (q.get('loop') === '1') startLoop(stage, player);
if (q.has('demo')) startDemo(player, q.get('demo') || undefined);

// 方便在浏览器控制台里调试
(window as unknown as { starfall: unknown }).starfall = { player, get config() { return config; } };
