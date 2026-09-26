// 运行环境检测：给自检页显示，也上报给服务端（F-OU-08、F-OU-11）
export type Level = 'ok' | 'mid' | 'bad';

export interface EnvReport {
  host: string;
  chrome: number | null;
  webmVp9: boolean;
  webmVp8: boolean;
  blur: boolean;
  dynamicBorder: boolean;
  audio: boolean;
  websocket: boolean;
  viewport: string;
}

export function detect(): EnvReport {
  const ua = navigator.userAgent;
  const chrome = Number((/Chrome\/(\d+)/.exec(ua) ?? [])[1]) || null;
  const w = window as unknown as { obsstudio?: { pluginVersion?: string }; webkitAudioContext?: unknown };
  const host = w.obsstudio ? `OBS Studio${w.obsstudio.pluginVersion ? `（浏览器插件 ${w.obsstudio.pluginVersion}）` : ''}` : /bili|livehime/i.test(ua) ? 'B站直播姬' : '普通浏览器 / 未识别的直播软件';
  const v = document.createElement('video');
  return {
    host,
    chrome,
    webmVp9: v.canPlayType('video/webm; codecs="vp9"') !== '',
    webmVp8: v.canPlayType('video/webm; codecs="vp8"') !== '',
    blur: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
    dynamicBorder: 'registerProperty' in CSS && (CSS.supports('mask-composite', 'exclude') || CSS.supports('-webkit-mask-composite', 'xor')),
    audio: 'AudioContext' in window || Boolean(w.webkitAudioContext),
    websocket: 'WebSocket' in window,
    viewport: `${innerWidth}×${innerHeight}`,
  };
}

export function knownHost(e: EnvReport): boolean {
  return !e.host.startsWith('普通浏览器');
}

export function checklist(e: EnvReport, canvas: string): Array<[string, string, Level]> {
  return [
    ['运行环境', e.host, knownHost(e) ? 'ok' : 'mid'],
    ['浏览器内核', e.chrome ? `Chromium ${e.chrome}` : '未知', e.chrome ? (e.chrome >= 95 ? 'ok' : 'mid') : 'mid'],
    ['透明 WebM 视频（VP9）', e.webmVp9 ? '支持' : '不支持', e.webmVp9 ? 'ok' : e.webmVp8 ? 'mid' : 'bad'],
    ['毛玻璃效果', e.blur ? '支持' : '不支持 · 自动改用实色底', e.blur ? 'ok' : 'mid'],
    ['动态描边（流星特效）', e.dynamicBorder ? '支持' : '不支持 · 自动改用静态描边', e.dynamicBorder ? 'ok' : 'mid'],
    ['音效播放', e.audio ? '支持（点下方按钮试听）' : '不支持', e.audio ? 'ok' : 'bad'],
    ['实时连接（WebSocket）', e.websocket ? '支持' : '不支持', e.websocket ? 'ok' : 'bad'],
    ['当前画布', `${canvas} · 页面 ${e.viewport}`, 'ok'],
  ];
}
