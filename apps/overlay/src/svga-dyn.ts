// SVGA 图层替换：把观众的头像、头像框、身份图标、昵称、欢迎语放进 SVGA 预留的图层。
// 文字自己画成图片再替换（播放器自带的文字没有描边、阴影，而且原来的占位图还会留在下面）。
import type { SvgaDyn } from '@starfall/shared/overlay';
import { thumb } from './parts.ts';

/** 透明的 1×1 图：这一层藏起来（例如不是大航海时的头像框）。现场画一张，保证是透明的 */
let emptyUrl = '';
const EMPTY = () => (emptyUrl ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).toDataURL('image/png'));
const GRADS = [['#6E6BF2', '#3C39B8'], ['#E0689B', '#A83C6A'], ['#2FA6A0', '#1C6E6A'], ['#E58B3A', '#A85A1C'], ['#5B8DEF', '#2F5CB8'], ['#9A6BE0', '#6A3FB0']];
const FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

interface Target {
  setImage(src: string, key: string): void;
}

/** 画布大小：按原图大小的 2 倍画（清楚一些），最大 1024 */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D, number] {
  const k = Math.min(2, 1024 / Math.max(w, h, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d')!;
  x.scale(k, k);
  return [c, x, k];
}

function loadImage(url: string, ms = 2500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const t = setTimeout(() => resolve(null), ms);
    img.onload = () => (clearTimeout(t), resolve(img));
    img.onerror = () => (clearTimeout(t), resolve(null));
    img.src = url;
  });
}

/** 头像：圆形（或方形）裁好；加载不到时用昵称的第一个字画一个渐变头像 */
async function avatar(d: SvgaDyn): Promise<string> {
  const round = d.role === 'avatar';
  const [c, x] = canvas(d.w, d.h);
  const s = Math.min(d.w, d.h);
  const ox = (d.w - s) / 2, oy = (d.h - s) / 2;
  if (round) { x.beginPath(); x.arc(d.w / 2, d.h / 2, s / 2, 0, Math.PI * 2); x.clip(); }
  const img = d.url ? await loadImage(thumb(d.url, s)) : null;
  if (img) {
    // 居中裁成正方形
    const m = Math.min(img.naturalWidth, img.naturalHeight);
    x.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, ox, oy, s, s);
  } else {
    const name = d.text || '?';
    const [g1, g2] = GRADS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % GRADS.length]!;
    const g = x.createLinearGradient(ox, oy, ox + s, oy + s); g.addColorStop(0, g1!); g.addColorStop(1, g2!);
    x.fillStyle = g; x.fillRect(ox, oy, s, s);
    x.fillStyle = '#fff'; x.font = `600 ${s * 0.44}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText([...name][0] ?? '?', d.w / 2, d.h / 2 + s * 0.02);
  }
  try {
    return c.toDataURL('image/png');
  } catch {
    // 图片不允许跨域读取（画布被污染）：这一层藏起来，不把远程地址交给播放器
    return EMPTY();
  }
}

/** 文字：白字、深色描边和阴影，居中；放不下时缩小字号 */
function text(d: SvgaDyn): string {
  const [c, x] = canvas(d.w, d.h);
  const t = d.text ?? '';
  let size = Math.max(10, d.h * 0.72);
  x.font = `700 ${size}px ${FONT}`;
  while (size > 10 && x.measureText(t).width > d.w * 0.96) { size -= 1; x.font = `700 ${size}px ${FONT}`; }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round';
  x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = size * 0.18; x.shadowOffsetY = size * 0.05;
  x.strokeStyle = 'rgba(10,10,20,.72)'; x.lineWidth = Math.max(2, size * 0.14);
  x.strokeText(t, d.w / 2, d.h / 2);
  x.shadowColor = 'transparent';
  x.fillStyle = '#fff';
  x.fillText(t, d.w / 2, d.h / 2);
  return c.toDataURL('image/png');
}

/**
 * 头像框、图标：自己加载好（不带来源地址）再画成图片交给播放器。
 * 不能直接把 B 站的地址给播放器：播放器加载时会带上页面地址，被 B 站的防盗链拒绝，浏览器报 ORB 错误、画面出错
 */
async function picture(d: SvgaDyn): Promise<string> {
  const img = d.url ? await loadImage(d.url) : null;
  if (!img) return EMPTY();
  const [c, x] = canvas(d.w, d.h);
  x.drawImage(img, 0, 0, d.w, d.h);
  try {
    return c.toDataURL('image/png');
  } catch {
    return EMPTY();
  }
}

/** 把替换内容准备好并交给播放器（在开始播放前调用）：给播放器的都是画好的图片，不给远程地址 */
export async function applyDyn(player: Target, dyn: SvgaDyn[]): Promise<void> {
  // 等字体加载好再画字（最多等 1 秒）
  const words = dyn.filter((d) => d.role === 'name' || d.role === 'welcome').map((d) => d.text ?? '').join('');
  if (words) await Promise.race([document.fonts.load(`700 40px ${FONT}`, words).catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
  await Promise.all(dyn.map(async (d) => {
    let src: string;
    if (d.role === 'avatar' || d.role === 'avatarSquare') src = await avatar(d);
    else if (d.role === 'name' || d.role === 'welcome') src = text(d);
    else src = await picture(d);
    player.setImage(src, d.key);
  }));
}
