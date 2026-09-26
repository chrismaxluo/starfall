// 大航海 · 东方宫廷（与设计预览 design/preview/fx-royal.html 一致）：舰长「门楼」、提督「亭阁」、总督「金銮」。
// 画面按 1080 宽的竖屏设计，所有坐标以特效中心为原点。装饰部分是程序生成的 SVG（不含任何观众数据）；
// 昵称、欢迎语一律用 textContent 写入。
import type { PlayItem } from '@starfall/shared/overlay';
import './royal.css';
import { textWithoutName, thumb } from './parts.ts';

type Position = PlayItem['effect']['position'];

export type RoyalTier = 'cap' | 'adm' | 'gov';
export const ROYAL_STYLES: Record<string, RoyalTier> = { 'royal-cap': 'cap', 'royal-adm': 'adm', 'royal-gov': 'gov' };

interface Tier {
  zh: string;
  seal: string;
  m: string;
  fl: string;
  cl: string;
  dust: string[];
}
const TIER: Record<RoyalTier, Tier> = {
  cap: { zh: '舰长', seal: '光临', m: 'mCap', fl: 'fCap', cl: 'cCap', dust: ['#CDEFFB', '#FFFFFF'] },
  adm: { zh: '提督', seal: '驾到', m: 'mAdm', fl: 'fAdm', cl: 'cAdm', dust: ['#E6BF86', '#D9C2F5', '#FFFFFF'] },
  gov: { zh: '总督', seal: '驾临', m: 'mGov', fl: 'fGov', cl: 'cGov', dust: ['#F6DFA8', '#FFF4D6'] },
};

/** 位置：偏上 / 居中 / 偏下（特效中心在画面高度的百分比） */
const HERO_Y: Record<Position, number> = { top: 32, center: 40, bl: 48, br: 48 };

const NS = 'http://www.w3.org/2000/svg';
const f1 = (n: number) => (+n).toFixed(1);
let uid = 0;

function el(tag: string, cls: string, vars: Record<string, string> | null, ...kids: Array<Node | string | null>): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (vars) for (const [k, v] of Object.entries(vars)) e.style.setProperty(k, v);
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}
const lay = (inner: string): SVGSVGElement => {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'rx-lay');
  s.setAttribute('viewBox', '-540 -650 1080 1300');
  s.innerHTML = inner;
  return s;
};

// ---------- 共用的渐变、纹理（整页只放一份） ----------
const DEFS = `
<linearGradient id="mGov" x1="0" y1="-330" x2="0" y2="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFF4D6"/><stop offset=".16" stop-color="#E9C27A"/><stop offset=".32" stop-color="#9C6A24"/><stop offset=".48" stop-color="#F8E4B2"/><stop offset=".66" stop-color="#C99440"/><stop offset=".84" stop-color="#8C5A1C"/><stop offset="1" stop-color="#E9C27A"/></linearGradient>
<linearGradient id="mAdm" x1="0" y1="-330" x2="0" y2="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFF1E0"/><stop offset=".16" stop-color="#E6BF86"/><stop offset=".32" stop-color="#94643A"/><stop offset=".48" stop-color="#F6E0BC"/><stop offset=".66" stop-color="#C7955A"/><stop offset=".84" stop-color="#7E5530"/><stop offset="1" stop-color="#E6BF86"/></linearGradient>
<linearGradient id="mCap" x1="0" y1="-330" x2="0" y2="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F2FBFF"/><stop offset=".16" stop-color="#A9DDF0"/><stop offset=".32" stop-color="#4F8FB5"/><stop offset=".48" stop-color="#E4F6FC"/><stop offset=".66" stop-color="#7FBAD6"/><stop offset=".84" stop-color="#3D7399"/><stop offset="1" stop-color="#BFE6F4"/></linearGradient>
<linearGradient id="fGov" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6DC"/><stop offset=".4" stop-color="#E9C27A"/><stop offset=".75" stop-color="#B07A2E"/><stop offset="1" stop-color="#7A4E16"/></linearGradient>
<linearGradient id="fAdm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF3E2"/><stop offset=".4" stop-color="#E6BF86"/><stop offset=".75" stop-color="#A8733E"/><stop offset="1" stop-color="#6E4A26"/></linearGradient>
<linearGradient id="fCap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4FCFF"/><stop offset=".4" stop-color="#A9DDF0"/><stop offset=".75" stop-color="#4F8FB5"/><stop offset="1" stop-color="#2A5A7E"/></linearGradient>
<linearGradient id="cGov" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6DFA8" stop-opacity=".34"/><stop offset="1" stop-color="#B8843A" stop-opacity=".04"/></linearGradient>
<linearGradient id="cAdm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EEDDF2" stop-opacity=".2"/><stop offset="1" stop-color="#A678B0" stop-opacity=".02"/></linearGradient>
<linearGradient id="cCap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#CDEFFB" stop-opacity=".32"/><stop offset="1" stop-color="#3D7399" stop-opacity=".04"/></linearGradient>
<radialGradient id="pGov" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#FFFBEE"/><stop offset=".55" stop-color="#F2C46E"/><stop offset="1" stop-color="#8C5A1C"/></radialGradient>
<radialGradient id="pAdm" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#F6E6F4"/><stop offset=".5" stop-color="#9A5AA0"/><stop offset="1" stop-color="#3E1446"/></radialGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#F7D58B" stop-opacity=".42"/><stop offset=".45" stop-color="#E4BD72" stop-opacity=".12"/><stop offset="1" stop-color="#E4BD72" stop-opacity="0"/></radialGradient>
<radialGradient id="haloCap"><stop offset="0" stop-color="#9FD3EA" stop-opacity=".38"/><stop offset=".45" stop-color="#6FAFD0" stop-opacity=".1"/><stop offset="1" stop-color="#6FAFD0" stop-opacity="0"/></radialGradient>
<radialGradient id="haloAdm"><stop offset="0" stop-color="#9A4E98" stop-opacity=".3"/><stop offset=".5" stop-color="#6E2E70" stop-opacity=".08"/><stop offset="1" stop-color="#6E2E70" stop-opacity="0"/></radialGradient>
<radialGradient id="gFlash"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".3" stop-color="#FFF1CC" stop-opacity=".7"/><stop offset="1" stop-color="#F7D58B" stop-opacity="0"/></radialGradient>
<radialGradient id="fade"><stop offset=".35" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
<linearGradient id="pillar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5E1810"/><stop offset=".35" stop-color="#B3342A"/><stop offset=".55" stop-color="#E06A52"/><stop offset=".7" stop-color="#B3342A"/><stop offset="1" stop-color="#5E1810"/></linearGradient>
<linearGradient id="pillarBlue" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#081A30"/><stop offset=".4" stop-color="#1F4F86"/><stop offset=".58" stop-color="#3F7BC0"/><stop offset=".72" stop-color="#1F4F86"/><stop offset="1" stop-color="#081A30"/></linearGradient>
<linearGradient id="post" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#12040F"/><stop offset=".22" stop-color="#3A1240"/><stop offset=".4" stop-color="#5E2466"/><stop offset=".47" stop-color="#B27AB4"/><stop offset=".53" stop-color="#6A2C72"/><stop offset=".78" stop-color="#3A1240"/><stop offset="1" stop-color="#12040F"/></linearGradient>
<linearGradient id="tilePurple" x1="0" y1="-300" x2="0" y2="-192" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9C6AA8"/><stop offset=".3" stop-color="#6E3478"/><stop offset=".7" stop-color="#4A1C54"/><stop offset="1" stop-color="#2E0E36"/></linearGradient>
<linearGradient id="tileBlue" x1="0" y1="-240" x2="0" y2="-186" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#CFE8FF"/><stop offset=".4" stop-color="#5E9BDA"/><stop offset=".8" stop-color="#244F8C"/><stop offset="1" stop-color="#16325C"/></linearGradient>
<linearGradient id="roof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A2608" stop-opacity=".85"/><stop offset="1" stop-color="#1E1404" stop-opacity=".75"/></linearGradient>
<linearGradient id="tile" x1="0" y1="-280" x2="0" y2="-200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFF1CC"/><stop offset=".5" stop-color="#E4B460"/><stop offset="1" stop-color="#9C6A24"/></linearGradient>
<linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000"/><stop offset=".42" stop-color="#000"/><stop offset=".5" stop-color="#fff"/><stop offset=".58" stop-color="#000"/><stop offset="1" stop-color="#000"/></linearGradient>
<filter id="goldFleck" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="1" seed="21" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 14 -9" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
<filter id="goldFleck2" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 16 -11" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
<filter id="enamelGrain" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.4 -1.2" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
<pattern id="yuzi" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.05" fill="none" stroke="rgba(80,46,6,.7)" stroke-width=".55"/></pattern>
<filter id="toWhite" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 .98  0 0 0 0 .9  0 0 0 1 0"/></filter>
<filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>
<filter id="ink"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
<pattern id="huiwen" width="30" height="16" patternUnits="userSpaceOnUse" x="-15" y="-201"><path d="M1 14 V2 H27 V12 H9 V7 H20" fill="none" stroke="#E8C07A" stroke-width="1.6"/></pattern>
<pattern id="yunwen" width="120" height="80" patternUnits="userSpaceOnUse"><path d="M10 50 c0 -14 18 -18 24 -8 c4 -12 24 -12 26 2 c10 -2 16 8 10 16 H14 c-8 0 -10 -8 -4 -10z M70 18 c0 -8 10 -10 14 -4 c2 -7 14 -7 15 1 c6 -1 9 5 6 9 H72 c-5 0 -6 -5 -2 -6z" fill="none" stroke="#E8C07A" stroke-width="1.2"/></pattern>
<symbol id="rxSpark" viewBox="0 0 24 24"><path fill="#FFF1CC" d="M12 0c.8 6.6 3.1 9 12 12-8.9 3-11.2 5.4-12 12-.8-6.6-3.1-9-12-12 8.9-3 11.2-5.4 12-12z"/></symbol>`;

let defsReady = false;
function ensureDefs(): void {
  if (defsReady) return;
  defsReady = true;
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', '0');
  s.setAttribute('height', '0');
  s.setAttribute('aria-hidden', 'true');
  s.style.position = 'absolute';
  s.innerHTML = `<defs>${DEFS}</defs>`;
  document.body.prepend(s);
}

// ---------- 部件 ----------
const P = (d: string, d0: number, t: number, stroke: string, sw: number) => `<path d="${d}" pathLength="1" class="rx-draw rx-ln" style="--d:${d0}s;--t:${t}s" stroke="${stroke}" stroke-width="${sw}"/>`;
const STAR = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r} C${cx + r * 0.1} ${cy - r * 0.28} ${cx + r * 0.28} ${cy - r * 0.1} ${cx + r} ${cy} C${cx + r * 0.28} ${cy + r * 0.1} ${cx + r * 0.1} ${cy + r * 0.28} ${cx} ${cy + r} C${cx - r * 0.1} ${cy + r * 0.28} ${cx - r * 0.28} ${cy + r * 0.1} ${cx - r} ${cy} C${cx - r * 0.28} ${cy - r * 0.1} ${cx - r * 0.1} ${cy - r * 0.28} ${cx} ${cy - r}Z`;
const pol = (deg: number, r: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
};
const pp = (deg: number, r: number) => pol(deg, r).map(f1).join(' ');
const ringHalf = (rr: number, side: number, dd: number, sw: number, stroke: string) => P(`M0 ${-rr} A${rr} ${rr} 0 0 ${side < 0 ? 0 : 1} 0 ${rr}`, dd, 1.1, stroke, sw);
const ringLine = (rr: number, dd: number, sw: number, stroke: string) => ringHalf(rr, -1, dd, sw, stroke) + ringHalf(rr, 1, dd, sw, stroke);
const annulus = (a: number, b: number) => `M${b} 0 A${b} ${b} 0 1 0 ${-b} 0 A${b} ${b} 0 1 0 ${b} 0 Z M${a} 0 A${a} ${a} 0 1 1 ${-a} 0 A${a} ${a} 0 1 1 ${a} 0 Z`;

/** 背景：一层淡淡的光 + 云纹 */
function backdrop(halo: string, r: number, op: number, d: number): string {
  const id = `yun${++uid}`;
  return `<circle r="${r}" fill="url(#${halo})" class="rx-f" style="--d:.1s"/><defs><mask id="${id}"><circle r="${r - 40}" fill="url(#fade)"/></mask></defs><g opacity="${op}"><g mask="url(#${id})" class="rx-f" style="--d:${d}s;--t:1.4s"><rect x="${40 - r}" y="${40 - r}" width="${2 * r - 80}" height="${2 * r - 80}" fill="url(#yunwen)"/></g></g>`;
}

// 如意云头祥云：底色渐变 + 金属描边 + 内侧高光线 + 卷
const CLOUD = 'M0 0 C-6 -26 22 -40 40 -24 C46 -46 84 -50 96 -26 C114 -38 140 -26 134 -4 C150 -2 158 18 144 28 L-60 28 C-86 28 -92 2 -70 -4 C-62 -8 -46 -6 -40 2 C-34 -10 -12 -12 0 0 Z';
const CURL = 'M40 -24 C44 -12 36 -2 26 -6 C18 -10 22 -20 30 -18 M96 -26 C98 -12 88 -6 80 -10 C74 -14 78 -22 84 -20 M134 -4 C128 6 116 4 116 -4 M-40 2 C-38 12 -50 14 -54 8';
function cloud(T: Tier, x: number, y: number, sc: number, flip: number, d: number, bd: number): string {
  return (
    `<g class="rx-cloud" style="--d:${d}s;--fx:${flip * 150}px"><g style="--bd:${bd}s"><g transform="translate(${x} ${y}) scale(${flip * sc} ${sc})">` +
    `<path d="${CLOUD}" fill="url(#${T.cl})" stroke="url(#${T.fl})" stroke-width="${f1(2.6 / sc)}"/>` +
    `<path d="${CLOUD}" fill="none" stroke="rgba(255,250,235,.35)" stroke-width="${f1(0.9 / sc)}" transform="translate(1.6 1.8) scale(.97)"/>` +
    `<path d="${CURL}" fill="none" stroke="url(#${T.fl})" stroke-width="${f1(1.8 / sc)}" stroke-linecap="round"/></g></g></g>`
  );
}
function tassel(x: number, y: number, len: number, color: string, d: number, pe: string): string {
  return (
    `<g class="rx-tassel" style="--d:${d}s"><g><path d="M${x} ${y} V${y + len}" stroke="url(#mGov)" stroke-width="1.6"/><circle cx="${x}" cy="${y + len + 4}" r="6" fill="url(#${pe})"/><path d="M${x - 7} ${y + len + 10} h14 l-3 10 h-8z" fill="${color}"/>` +
    [-6, -3, 0, 3, 6].map((o) => `<path d="M${x + o * 0.8} ${y + len + 20} L${x + o * 1.4} ${y + len + 56}" stroke="${color}" stroke-width="1.5" opacity=".9"/>`).join('') +
    `</g></g>`
  );
}
/** 红色印章，两个字 */
function seal(text: string, size: number, d: number): HTMLElement {
  const [a = '', b = ''] = [...text];
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 80 80');
  s.innerHTML =
    `<g filter="url(#rough)"><rect x="3" y="3" width="74" height="74" rx="7" fill="#B8301F"/><g filter="url(#ink)"><rect x="3" y="3" width="74" height="74" rx="7" fill="#D84A34" opacity=".7"/></g>` +
    `<rect x="9" y="9" width="62" height="62" rx="4" fill="none" stroke="#FFE3D2" stroke-width="2.4" opacity=".85"/>` +
    `<text x="40" y="36" text-anchor="middle" class="rx-sealtx">${a}</text><text x="40" y="66" text-anchor="middle" class="rx-sealtx">${b}</text></g>`;
  return el('div', 'rx-seal', { '--ss': `${size}px`, '--sd': `${d}s` }, s);
}

// 头像圆环（舰长、总督）：珐琅底 + 金丝花纹 + 绳纹 + 錾金团花；总督外沿两层莲瓣
const RING = {
  cap: { w: 18, metal: 'mGov', fill: 'fGov', enamel: ['#0B2440', '#3A7FC0', '#081C32'], grain: '#D8ECFF' },
  gov: { w: 26, metal: 'mGov', fill: 'fGov', enamel: ['#5E120C', '#C8392C', '#4A0E09'], grain: '#FFD9C8' },
};
function royalRing(key: 'cap' | 'gov', R: number, d0: number): string {
  const C = RING[key];
  const rin = R + 3;
  const rout = rin + C.w;
  const mid = (rin + rout) / 2;
  const id = `rg${++uid}`;
  let s = `<defs><radialGradient id="${id}" cx="0" cy="0" r="${rout}" gradientUnits="userSpaceOnUse"><stop offset="${(rin / rout).toFixed(3)}" stop-color="${C.enamel[2]}"/><stop offset="${(mid / rout).toFixed(3)}" stop-color="${C.enamel[1]}"/><stop offset="1" stop-color="${C.enamel[0]}"/></radialGradient></defs>`;
  s += `<g class="rx-ringIn" style="--d:${d0}s">`;
  // 珐琅底 + 砂感 + 釉面反光
  s += `<path d="${annulus(rin, rout)}" fill="url(#${id})" fill-rule="evenodd"/>`;
  s += `<path d="${annulus(rin, rout)}" fill="${C.grain}" fill-rule="evenodd" filter="url(#enamelGrain)" opacity=".5" class="rx-tex"/>`;
  s += `<path d="M${pp(-62, mid)} A${mid} ${mid} 0 0 1 ${pp(28, mid)}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="${f1(C.w * 0.32)}" stroke-linecap="round"/>`;
  // 金丝花纹：舰长回纹，总督缠枝莲
  let pat = '';
  if (key === 'cap') {
    const N = 40;
    const ua = 360 / N;
    const U = [[0, 0.18], [0, 0.82], [0.78, 0.82], [0.78, 0.36], [0.3, 0.36], [0.3, 0.6], [0.55, 0.6]] as const;
    for (let i = 0; i < N; i++) pat += 'M' + U.map(([u, v]) => pp(i * ua + u * ua + ua * 0.11, rin + v * C.w)).join(' L');
  } else {
    const K = 16;
    const amp = C.w * 0.22;
    for (let i = 0; i <= 720; i++) {
      const a = i / 2;
      pat += (i ? ' L' : 'M') + pp(a, mid + amp * Math.sin((a * K * Math.PI) / 180));
    }
    for (let j = 0; j < K * 2; j++) {
      const a = ((j + 0.5) * 180) / K;
      const up = j % 2 === 0;
      const [x, y] = pol(a + (90 / K) * 0.6, mid + (up ? 1 : -1) * amp * 0.2);
      const sc = (C.w / 22).toFixed(2);
      s += up
        ? `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(a)}) scale(${sc})" class="rx-f" style="--d:${(d0 + 0.6 + j * 0.02).toFixed(2)}s"><path d="M0 4 C-7 0 -7 -6 -3 -9 C-2 -4 -1 -2 0 0 C1 -2 2 -4 3 -9 C7 -6 7 0 0 4Z M0 1 C-2 -4 -1 -9 0 -11 C1 -9 2 -4 0 1Z" fill="url(#${C.fill})" stroke="rgba(255,244,214,.6)" stroke-width=".5"/></g>`
        : `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(a + 270)}) scale(${sc})"><path d="M0 0 C3 -5 9 -5 9 0 C9 4 4 5 3 2" fill="none" stroke="url(#${C.metal})" stroke-width="1.3" class="rx-draw" pathLength="1" style="--d:${(d0 + 0.5 + j * 0.02).toFixed(2)}s;--t:.6s"/><path d="M-2 1 C-6 -3 -10 -1 -10 3 C-7 5 -4 4 -2 1Z" fill="url(#${C.fill})" class="rx-f" style="--d:${(d0 + 0.8).toFixed(2)}s"/></g>`;
    }
  }
  s += `<path d="${pat}" fill="none" stroke="url(#${C.metal})" stroke-width="${key === 'cap' ? 1.5 : 1.7}" stroke-linejoin="round" stroke-linecap="round" pathLength="1" class="rx-draw" style="--d:${d0 + 0.2}s;--t:1.4s"/>`;
  // 内外金边（带一道高光）+ 内圈金珠
  for (const [rr, sw] of [[rin, 3], [rout, 3.4]] as const) s += ringLine(rr, d0, sw, `url(#${C.metal})`);
  s += ringLine(rout - 1.4, d0 + 0.05, 0.8, 'rgba(255,250,235,.6)');
  if (key === 'gov') s += `<circle r="${rin - 5}" fill="none" stroke="url(#${C.metal})" stroke-width="3" stroke-dasharray="0 7.6" stroke-linecap="round" class="rx-f" style="--d:${d0 + 0.9}s"/>`;
  // 总督外沿：两层莲瓣（外层錾刻鱼子纹）
  if (key === 'gov') {
    const N = 28;
    const w = (2 * Math.PI * rout) / N;
    for (const [layer, off, hh, op] of [[0, 0.5, 14, 0.75], [1, 0, 20, 1]] as const) {
      for (let i = 0; i < N; i++) {
        const a = ((i + off) * 360) / N;
        const [x, y] = pol(a, rout + 1);
        const ww = w * (layer ? 0.92 : 0.8);
        s += `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(a)})"><g class="rx-bloom" style="--d:${(d0 + 0.9 + layer * 0.15 + i * 0.012).toFixed(3)}s"><path d="${petal(ww, hh)}" fill="url(#${C.fill})" stroke="rgba(255,244,214,.7)" stroke-width=".8" opacity="${op}"/>${layer ? petalTex(ww, hh) : ''}</g></g>`;
      }
    }
  }
  // 绳纹：一圈拧起来的金绳
  let rope = '';
  for (let i = 0; i < 132; i++) {
    const a = (i * 360) / 132;
    rope += `M${pp(a, rout - 1.8)} L${pp(a + 2.2, rout + 2.2)} `;
  }
  s += `<circle r="${rout}" fill="none" stroke="url(#${C.metal})" stroke-width="4.6" class="rx-f" style="--d:${d0 + 0.4}s"/><path d="${rope}" stroke="rgba(70,40,6,.6)" stroke-width="1" class="rx-f" style="--d:${d0 + 0.45}s"/>`;
  // 錾金团花
  for (const [k, a] of [0, 90, 180, 270].entries()) s += rosette(pol(a, mid), C.w * 0.5, C.fill, d0 + 1.1 + k * 0.08);
  return s + `</g>`;
}
const petal = (ww: number, hh: number, k = 1, y0 = 0) =>
  `M${f1((-ww / 2) * k)} ${y0} C${f1((-ww / 2) * k)} ${f1(-hh * 0.6 * k)} ${f1(-ww * 0.16 * k)} ${f1(-hh * k)} 0 ${f1(-hh * k)} C${f1(ww * 0.16 * k)} ${f1(-hh * k)} ${f1((ww / 2) * k)} ${f1(-hh * 0.6 * k)} ${f1((ww / 2) * k)} ${y0}`;
// 莲瓣錾刻：鱼子纹底 + 内轮廓 + 中脉
function petalTex(ww: number, hh: number): string {
  return `<path d="${petal(ww, hh)} Z" fill="url(#yuzi)" opacity=".75"/><path d="${petal(ww, hh, 0.7, -1.5)}" fill="none" stroke="rgba(80,46,6,.6)" stroke-width=".9"/><path d="M0 -2 V${f1(-hh * 0.62)}" stroke="rgba(80,46,6,.55)" stroke-width="1"/>`;
}
// 錾金团花：八瓣扁平金花 + 刻线
function rosette([x, y]: [number, number], r: number, fill: string, d: number): string {
  let petals = '';
  for (let i = 0; i < 8; i++) petals += `<path d="M0 0 C${f1(r * 0.25)} ${f1(-r * 0.3)} ${f1(r * 0.2)} ${f1(-r * 0.85)} 0 ${f1(-r)} C${f1(-r * 0.2)} ${f1(-r * 0.85)} ${f1(-r * 0.25)} ${f1(-r * 0.3)} 0 0Z" transform="rotate(${i * 45})"/>`;
  return `<g class="rx-gem" style="--d:${d.toFixed(2)}s" transform="translate(${f1(x)} ${f1(y)})"><g fill="url(#${fill})" stroke="rgba(70,40,6,.55)" stroke-width=".7">${petals}</g><circle r="${f1(r * 0.28)}" fill="url(#${fill})" stroke="rgba(70,40,6,.6)" stroke-width=".7"/><circle r="${f1(r * 0.1)}" fill="rgba(70,40,6,.6)"/></g>`;
}

// 提督 · 八角描金框：和八角亭呼应。深茄紫漆面 + 洒金，外沿金边 + 描金双线，每条边一道金卷云，八个角各一颗小星，内圈金边 + 联珠
function octRing(R: number, d0: number): string {
  const rin = R + 3;
  const ri = rin + 24;
  const rc = ri / Math.cos(Math.PI / 8);
  const id = `oc${++uid}`;
  const oct = (r: number) => Array.from({ length: 8 }, (_, i) => (i ? 'L' : 'M') + pp(22.5 + i * 45, r)).join(' ') + ' Z';
  const circ = (r: number) => `M${r} 0 A${r} ${r} 0 1 1 ${-r} 0 A${r} ${r} 0 1 1 ${r} 0 Z`;
  let s = `<defs><radialGradient id="${id}" cx="0" cy="0" r="${f1(rc)}" gradientUnits="userSpaceOnUse"><stop offset="${(rin / rc).toFixed(3)}" stop-color="#16061A"/><stop offset="${((rin + 12) / rc).toFixed(3)}" stop-color="#4A1A52"/><stop offset="1" stop-color="#22092A"/></radialGradient></defs>`;
  s += `<g class="rx-ringIn" style="--d:${d0}s">`;
  s += `<path d="${oct(rc)} ${circ(rin)}" fill="url(#${id})" fill-rule="evenodd"/>`;
  s += `<path d="${oct(rc)} ${circ(rin)}" fill="#F3D39B" fill-rule="evenodd" filter="url(#goldFleck)" opacity=".42" class="rx-tex"/>`;
  s += `<path d="${oct(rc)} ${circ(rin)}" fill="#FFF3D6" fill-rule="evenodd" filter="url(#goldFleck2)" opacity=".5" class="rx-tex"/>`;
  s += `<path d="M${pp(-66, rin + 12)} A${rin + 12} ${rin + 12} 0 0 1 ${pp(20, rin + 12)}" fill="none" stroke="rgba(255,236,250,.16)" stroke-width="9" stroke-linecap="round"/>`;
  const scroll = 'M-34 2 C-30 -7 -18 -8 -14 -1 C-11 5 -4 5 -4 -1 C-4 -5 -9 -6 -11 -3 M34 2 C30 -7 18 -8 14 -1 C11 5 4 5 4 -1 C4 -5 9 -6 11 -3 M-14 -1 C-8 -9 8 -9 14 -1';
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    const [x, y] = pol(a, (rin + ri) / 2 + 1.5);
    s += `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${a})"><path d="${scroll}" fill="none" stroke="url(#mAdm)" stroke-width="1.6" stroke-linecap="round" pathLength="1" class="rx-draw" style="--d:${(d0 + 0.5 + i * 0.05).toFixed(2)}s;--t:.8s"/></g>`;
  }
  for (let i = 0; i < 8; i++) {
    const [x, y] = pol(22.5 + i * 45, rc - 16);
    s += `<g class="rx-gem" style="--d:${(d0 + 1 + i * 0.06).toFixed(2)}s"><path d="${STAR(+f1(x), +f1(y), 7.5)}" fill="url(#fAdm)" stroke="rgba(70,36,8,.55)" stroke-width=".6"/><circle cx="${f1(x)}" cy="${f1(y)}" r="1.4" fill="#FFF6E6"/></g>`;
  }
  s += `<path d="${oct(rc)}" pathLength="1" class="rx-draw rx-ln" style="--d:${d0}s;--t:1.2s" stroke="url(#mAdm)" stroke-width="5"/>`;
  s += `<path d="${oct(rc - 2.2)}" fill="none" stroke="rgba(255,248,235,.55)" stroke-width=".9" class="rx-f" style="--d:${d0 + 0.6}s"/>`;
  s += `<path d="${oct(rc - 7)}" pathLength="1" class="rx-draw rx-ln" style="--d:${d0 + 0.15}s;--t:1.2s" stroke="url(#mAdm)" stroke-width="1.2"/>`;
  s += ringLine(rin, d0, 3, 'url(#mAdm)') + ringLine(rin + 1.2, d0 + 0.05, 0.7, 'rgba(255,248,235,.5)');
  s += `<circle r="${rin + 6}" fill="none" stroke="url(#mAdm)" stroke-width="3.4" stroke-dasharray="0 8.2" stroke-linecap="round" class="rx-f" style="--d:${d0 + 0.8}s"/>`;
  return s + `</g>`;
}

// 立柱（颜色可换）：漆柱 + 金柱头、柱础、一道高光
function pillarPair(x0: number, w: number, top: number, bottom: number, grad: string, fill: string, hi: string, d: number): string {
  const one = (x: number) =>
    `<g class="rx-pillar" style="--d:${d}s"><rect x="${x}" y="${top}" width="${w}" height="${bottom - top}" fill="url(#${grad})"/><path d="M${x + w * 0.3} ${top + 8} V${bottom - 6}" stroke="${hi}" stroke-width="1.2" opacity=".35"/>` +
    `<rect x="${x - 6}" y="${top - 12}" width="${w + 12}" height="13" rx="2" fill="url(#${fill})"/><rect x="${x - 6}" y="${top}" width="${w + 12}" height="3" fill="rgba(40,24,4,.55)"/>` +
    `<path d="M${x - 13} ${bottom} h${w + 26} l5 13 h${-w - 36}z" fill="url(#${fill})"/><ellipse cx="${x + w / 2}" cy="${bottom + 15}" rx="${w / 2 + 16}" ry="4.5" fill="url(#${fill})"/></g>`;
  return one(-x0 - w) + one(x0);
}
/** 台基：几道由中间向两边画出的金线 */
const base = (rows: ReadonlyArray<readonly [number, number, number]>, d: number, m: string) =>
  rows.map(([y, w, sw], i) => P(`M0 ${y} H${-w}`, d + i * 0.08, 0.9, `url(#${m})`, sw) + P(`M0 ${y} H${w}`, d + i * 0.08, 0.9, `url(#${m})`, sw)).join('');

// 门楼屋顶：一片片蓝琉璃筒瓦 + 金瓦当 + 金屋脊，两端起翘，正脊中间一颗宝珠
function menlou(d: number): string {
  const W = 250;
  const eaveY = (x: number) => -188 - 18 * Math.pow(Math.abs(x) / W, 2.4);
  const ridgeY = (x: number) => -238 - 4 * (1 - Math.pow(x / 200, 2));
  const t = (xx: number) => `M${f1(xx)} ${f1(ridgeY(xx) + 5)} Q${f1(xx * 1.1)} ${f1((ridgeY(xx) + eaveY(xx * 1.24)) / 2)} ${f1(xx * 1.24)} ${f1(eaveY(xx * 1.24) - 4)}`;
  let tiles = '';
  let ends = '';
  for (let x = -196; x <= 196; x += 16) {
    const ex = x * 1.24;
    const ey = eaveY(ex);
    tiles += `<path d="${t(x)}" fill="none" stroke="url(#tileBlue)" stroke-width="7" stroke-linecap="round"/><path d="${t(x + 8)}" fill="none" stroke="rgba(6,18,34,.6)" stroke-width="1.1"/>`;
    ends += `<circle cx="${f1(ex)}" cy="${f1(ey - 2)}" r="5.2" fill="url(#pGov)" stroke="rgba(40,22,4,.7)" stroke-width=".8"/><circle cx="${f1(ex)}" cy="${f1(ey - 2)}" r="1.6" fill="rgba(70,40,6,.7)"/>`;
  }
  const eave = Array.from({ length: 41 }, (_, i) => {
    const x = -W + (i * W) / 20;
    return `${i ? 'L' : 'M'}${f1(x)} ${f1(eaveY(x))}`;
  }).join(' ');
  let brackets = '';
  for (let x = -220; x <= 220; x += 22) brackets += `<rect x="${x - 4.5}" y="${f1(eaveY(x) + 3)}" width="9" height="7" rx="1.5" fill="url(#fGov)"/>`;
  return (
    `<g class="rx-drop" style="--d:${d}s"><path d="${eave} L200 ${f1(ridgeY(200))} L-200 ${f1(ridgeY(-200))} Z" fill="#0C1C30"/>${tiles}${ends}` +
    `<path d="${eave}" fill="none" stroke="url(#mGov)" stroke-width="4.4" stroke-linecap="round"/>` +
    `<path d="M${-W} ${f1(eaveY(-W))} q-15 -3 -22 -22 M${W} ${f1(eaveY(W))} q15 -3 22 -22" fill="none" stroke="url(#mGov)" stroke-width="4.6" stroke-linecap="round"/>` +
    `<path d="M-206 ${f1(ridgeY(-206))} H206" stroke="url(#mGov)" stroke-width="6.5" stroke-linecap="round"/><path d="M-200 ${f1(ridgeY(-200) - 2)} H200" stroke="rgba(255,250,235,.55)" stroke-width="1.1"/>` +
    `<path d="M-206 -238 q-12 -18 4 -28 q12 -5 10 7 M206 -238 q12 -18 -4 -28 q-12 -5 -10 7" fill="none" stroke="url(#mGov)" stroke-width="3.6" stroke-linecap="round"/>` +
    `${brackets}<path d="M0 -246 C-8 -258 -5 -270 0 -278 C5 -270 8 -258 0 -246Z" fill="url(#fGov)"/><circle cx="0" cy="-258" r="10" fill="url(#pGov)" stroke="#FFF4D6" stroke-width="1"/></g>`
  );
}

// 八角攒尖亭顶（正面看到三个面）：一垄垄筒瓦从宝顶收到檐口，瓦上有接缝和高光，两侧面暗一些；檐口金瓦当 + 滴水，两道垂脊，檐角上翘，金宝顶
function pavilion(d: number): string {
  const W = 258;
  const apex = -300;
  const HX = 0.4;
  const hw = 6.2;
  const eaveY = (x: number) => -190 - 30 * Math.pow(Math.abs(x) / W, 2.6);
  const q = (x: number, t: number): [number, number] => {
    const u = 1 - t;
    const y1 = -234 - (8 * Math.abs(x)) / W;
    return [u * u * x * 0.05 + 2 * u * t * x * 0.5 + t * t * x, u * u * (apex + 8) + 2 * u * t * y1 + t * t * eaveY(x)];
  };
  const curve = (x: number, t0 = 0, t1 = 1, n = 14) => Array.from({ length: n + 1 }, (_, i) => q(x, t0 + ((t1 - t0) * i) / n).map(f1).join(' '));
  const eave = Array.from({ length: 41 }, (_, i) => {
    const x = -W + (i * W) / 20;
    return `${i ? 'L' : 'M'}${f1(x)} ${f1(eaveY(x))}`;
  }).join(' ');
  let tiles = '';
  let joints = '';
  let lights = '';
  let ends = '';
  let drips = '';
  for (let x = -W + 10; x <= W - 10; x += 15) {
    tiles += `M${curve(x - hw).join(' L')} L${curve(x + hw).reverse().join(' L')} Z `;
    lights += `M${curve(x - hw * 0.35, 0.14).join(' L')} `;
    for (const t of [0.3, 0.42, 0.54, 0.66, 0.78, 0.9]) {
      const [a, b] = q(x - hw, t);
      const [c, e] = q(x + hw, t);
      joints += `M${f1(a)} ${f1(b)} Q${f1((a + c) / 2)} ${f1((b + e) / 2 + 2.4)} ${f1(c)} ${f1(e)} `;
    }
    const ey = eaveY(x);
    ends += `<circle cx="${f1(x)}" cy="${f1(ey - 1)}" r="5.4" fill="url(#pGov)" stroke="rgba(40,20,4,.7)" stroke-width=".8"/><circle cx="${f1(x)}" cy="${f1(ey - 1)}" r="1.7" fill="rgba(70,36,6,.7)"/>`;
    if (x + 7.5 < W - 10) drips += `M${f1(x + 3.5)} ${f1(eaveY(x + 7.5) + 1.5)} h8 l-4 7 Z `;
  }
  const side = (sg: number) =>
    `M${curve(sg * W * HX).join(' L')} ${Array.from({ length: 11 }, (_, i) => {
      const x = sg * (W * HX + ((W - W * HX) * i) / 10);
      return `L${f1(x)} ${f1(eaveY(x))}`;
    }).join(' ')} L${curve(sg * W).reverse().join(' L')} Z`;
  const hip = (x: number, sw: number) =>
    `<path d="M${curve(x).join(' L')}" fill="none" stroke="url(#mAdm)" stroke-width="${sw}" stroke-linecap="round"/><path d="M${curve(x - 1.2, 0.06).join(' L')}" fill="none" stroke="rgba(255,248,235,.45)" stroke-width=".9"/>`;
  let brackets = '';
  for (let x = -228; x <= 228; x += 24) brackets += `<rect x="${x - 4.5}" y="${f1(eaveY(x) + 8)}" width="9" height="7" rx="1.5" fill="url(#fAdm)"/>`;
  let lotus = '';
  for (let i = -3; i <= 3; i++) lotus += `<path d="M${i * 6.5} ${apex + 4} C${i * 6.5 - 5} ${apex - 2} ${i * 7.5 - 2} ${apex - 10} ${i * 8} ${apex - 12} C${i * 7.5 + 3} ${apex - 10} ${i * 6.5 + 5} ${apex - 2} ${i * 6.5} ${apex + 4}Z" fill="url(#fAdm)" stroke="rgba(70,36,8,.5)" stroke-width=".6"/>`;
  return (
    `<g class="rx-drop" style="--d:${d}s"><path d="M${curve(-W).join(' L')} ${eave.replace(/^M/, 'L')} L${curve(W).reverse().join(' L')} Z" fill="#1A0820"/>` +
    `<path d="${tiles}" fill="url(#tilePurple)"/><path d="${lights}" fill="none" stroke="rgba(244,214,246,.3)" stroke-width="1.2"/><path d="${joints}" fill="none" stroke="rgba(18,4,22,.55)" stroke-width="1.1"/>` +
    `<path d="${side(-1)}" fill="rgba(10,2,14,.34)"/><path d="${side(1)}" fill="rgba(10,2,14,.34)"/>` +
    `<path d="${eave}" fill="none" stroke="url(#mAdm)" stroke-width="4.5" stroke-linecap="round"/><path d="${drips}" fill="url(#fAdm)"/>${ends}` +
    `<path d="M${-W} ${f1(eaveY(-W))} q-16 -4 -24 -26 M${W} ${f1(eaveY(W))} q16 -4 24 -26" fill="none" stroke="url(#mAdm)" stroke-width="5" stroke-linecap="round"/>` +
    hip(-W, 6) + hip(W, 6) + hip(-W * HX, 4.2) + hip(W * HX, 4.2) +
    `${brackets}<ellipse cx="0" cy="${apex + 2}" rx="24" ry="8" fill="url(#fAdm)"/>${lotus}<circle cx="0" cy="${apex - 22}" r="12" fill="url(#pGov)" stroke="#FFF1E0" stroke-width="1"/><circle cx="0" cy="${apex - 40}" r="7.5" fill="url(#pGov)" stroke="#FFF1E0" stroke-width=".8"/><path d="M0 ${apex - 48} V${apex - 62}" stroke="url(#mAdm)" stroke-width="2.4" stroke-linecap="round"/></g>`
  );
}

// 金銮屋顶：琉璃瓦（一道道筒瓦）+ 圆形瓦当 + 屋檐 + 屋脊 + 宝珠
function palaceRoof(d: number): string {
  const eaveY = (x: number) => -206 - 34 * (1 - Math.pow(x / 310, 2));
  const ridgeY = (x: number) => -262 - 14 * (1 - Math.pow(x / 236, 2));
  let tiles = '';
  let ends = '';
  for (let x = -228; x <= 228; x += 19) {
    const ex = x * 1.3;
    const ey = eaveY(ex);
    const x2 = x + 9.5;
    tiles += `<path d="M${x} ${f1(ridgeY(x) + 5)} Q${f1(x * 1.15)} ${f1((ridgeY(x) + ey) / 2)} ${f1(ex)} ${f1(ey - 5)}" fill="none" stroke="url(#tile)" stroke-width="7.5" stroke-linecap="round"/>`;
    tiles += `<path d="M${f1(x2)} ${f1(ridgeY(x2) + 5)} Q${f1(x2 * 1.15)} ${f1((ridgeY(x2) + eaveY(x2 * 1.3)) / 2)} ${f1(x2 * 1.3)} ${f1(eaveY(x2 * 1.3) - 4)}" fill="none" stroke="rgba(40,22,2,.65)" stroke-width="1.3"/>`;
    ends += `<circle cx="${f1(ex)}" cy="${f1(ey - 3)}" r="6.2" fill="url(#pGov)" stroke="rgba(60,34,4,.7)" stroke-width=".8"/><circle cx="${f1(ex)}" cy="${f1(ey - 3)}" r="2" fill="rgba(90,52,8,.7)"/>`;
  }
  let brackets = '';
  for (let x = -260; x <= 260; x += 26) brackets += `<rect x="${x - 5}" y="${f1(eaveY(x) + 4)}" width="10" height="8" rx="1.5" fill="url(#fGov)"/>`;
  const fill = `M-310 -206 C-250 -212 -120 -240 0 -240 C120 -240 250 -212 310 -206 L236 -262 C120 -276 -120 -276 -236 -262 Z`;
  return (
    `<g class="rx-drop" style="--d:${d}s"><path d="${fill}" fill="url(#roof)"/>${tiles}${ends}` +
    `<path d="M-310 -206 C-250 -212 -120 -240 0 -240 C120 -240 250 -212 310 -206" fill="none" stroke="url(#mGov)" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M-310 -206 Q-328 -210 -338 -232 M310 -206 Q328 -210 338 -232" fill="none" stroke="url(#mGov)" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M-236 -262 C-120 -276 120 -276 236 -262" fill="none" stroke="url(#mGov)" stroke-width="7" stroke-linecap="round"/><path d="M-230 -264 C-120 -278 120 -278 230 -264" fill="none" stroke="rgba(255,250,235,.55)" stroke-width="1.2"/>` +
    `<path d="M-236 -262 q-12 -22 6 -32 q14 -6 12 8 M236 -262 q12 -22 -6 -32 q-14 -6 -12 8" fill="none" stroke="url(#mGov)" stroke-width="4" stroke-linecap="round"/>` +
    `${brackets}<path d="M0 -276 C-10 -290 -6 -304 0 -314 C6 -304 10 -290 0 -276Z" fill="url(#fGov)"/><circle cx="0" cy="-292" r="13" fill="url(#pGov)" stroke="#FFF4D6" stroke-width="1"/></g>`
  );
}

// 一道光扫过：把金色部件复制一份涂成白色，只在移动的光带里露出来
function sweep(inner: string, d: number): string {
  const id = `sw${++uid}`;
  return (
    `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-540" y="-650" width="1080" height="1300"><g transform="rotate(-24)"><rect x="-1500" y="-900" width="420" height="1800" fill="url(#band)" class="rx-swp" style="--d:${d}s"/></g></mask></defs>` +
    `<g mask="url(#${id})" filter="url(#toWhite)" opacity=".75" class="rx-sweep">${inner}</g>`
  );
}
function glints(list: Array<[number, number, number, number]>): HTMLElement[] {
  return list.map(([x, y, s, d]) => {
    const g = el('span', 'rx-glint', { '--px': `${x}px`, '--py': `${y}px`, '--s': `${s}px`, '--d': `${d}s` });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML = '<use href="#rxSpark"/>';
    g.append(svg);
    return g;
  });
}
function dusts(n: number, colors: string[], r: number, d0: number, d1: number): HTMLElement[] {
  return Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2;
    const rr = 120 + Math.random() * r;
    return el('span', 'rx-dust', {
      '--px': `${f1(Math.cos(a) * rr)}px`,
      '--py': `${f1(Math.sin(a) * rr * 0.7 + 40)}px`,
      '--s': `${f1(2 + Math.random() * 3.5)}px`,
      '--c': colors[Math.floor(Math.random() * colors.length)]!,
      '--t': `${f1(2.6 + Math.random() * 2)}s`,
      '--d': `${f1(d0 + Math.random() * (d1 - d0))}s`,
      '--dx': `${f1((Math.random() - 0.5) * 60)}px`,
      '--dy': `${f1(-120 - Math.random() * 180)}px`,
    });
  });
}
/** 头像：圆形展开 + 一道反光；没有头像（或加载失败）时显示昵称首字 */
function avatarEl(v: PlayItem['viewer'], size: number, avd: number, shd: number): HTMLElement {
  const aw = el('div', 'rx-av', { '--av': `${size}px`, '--avd': `${avd}s`, '--shd': `${shd}s` });
  const ini = el('span', 'rx-ini', null, [...(v.name || '?')][0] ?? '?');
  aw.append(ini);
  if (v.face) {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.onload = () => ini.replaceWith(img);
    img.src = thumb(v.face, size);
  }
  aw.append(el('i', '', null));
  return aw;
}

/** 印章文字：进场按等级（光临 / 驾到 / 驾临），上舰、续费写「上舰」「续费」，礼物「谢赏」 */
function sealText(item: PlayItem, T: Tier): string {
  if (item.kind === 'guard') return item.guardOp === 'renew' ? '续费' : '上舰';
  if (item.kind === 'gift') return '谢赏';
  return T.seal;
}

/** 两行字：上面一行小字（欢迎语去掉昵称的部分），下面昵称 + 印章 */
function texts(root: HTMLElement, item: PlayItem, T: Tier, key: RoyalTier, y: number, at: { lab: number; nm: number; seal: number }): void {
  const name = item.viewer.name;
  const lab = name && item.text.includes(name) ? textWithoutName(item.text, name) : item.text;
  if (lab) root.append(el('div', 'rx-tx', { '--y': `${y}px` }, el('div', 'rx-lab rx-metal', { '--d': `${at.lab}s` }, lab)));
  const nm = el('div', 'rx-nm rx-metal', { '--nd': `${at.nm}s` }, name || item.text);
  const wrap = el('div', 'rx-nmwrap', null, nm, seal(sealText(item, T), key === 'gov' ? 78 : key === 'adm' ? 72 : 66, at.seal));
  root.append(el('div', 'rx-tx', { '--y': `${y + (key === 'gov' ? 72 : key === 'adm' ? 66 : 60)}px` }, wrap));
}

// ---------- 舰长 · 门楼 ----------
function cap(item: PlayItem, root: HTMLElement): void {
  const T = TIER.cap;
  const halo = backdrop('haloCap', 420, 0.07, 0.3);
  const ring = royalRing('cap', 112, 0.25);
  const cl = cloud(T, -300, 96, 1.05, -1, 0.8, 0) + cloud(T, 300, 96, 1.05, 1, 0.9, -1.4);
  const pil = pillarPair(196, 15, -170, 196, 'pillarBlue', 'fGov', '#CFE8FF', 0.15);
  const bs = base([[212, 246, 2.2], [226, 272, 1.4]], 0.3, 'mGov');
  root.append(lay(`${halo}${cl}${pil}${bs}${ring}`));
  root.append(avatarEl(item.viewer, 224, 0.6, 2.3));
  const lintel = `<g class="rx-grow" style="--d:.6s"><rect x="-222" y="-186" width="444" height="15" fill="url(#huiwen)"/><path d="M-224 -188 H224" stroke="url(#mGov)" stroke-width="2.4"/><path d="M-224 -169 H224" stroke="url(#mGov)" stroke-width="1.9"/></g>`;
  const queti = `<g class="rx-f" style="--d:.8s"><path d="M-196 -167 Q-170 -167 -152 -178 L-196 -178Z M196 -167 Q170 -167 152 -178 L196 -178Z" fill="url(#fGov)" stroke="rgba(255,244,214,.6)" stroke-width=".8"/></g>`;
  const roof = menlou(0.7);
  const flash = `<circle cx="0" cy="-258" r="60" fill="url(#gFlash)" class="rx-flash" style="--d:1.6s"/>`;
  root.append(lay(`${queti}${lintel}${roof}${flash}${sweep(pil + ring + lintel + roof + cl, 2.2)}`));
  root.append(...glints([[0, -290, 20, 2.3], [-400, 60, 16, 2.6], [400, 60, 16, 2.8]]), ...dusts(8, T.dust, 280, 0.8, 2.4));
  texts(root, item, T, 'cap', 266, { lab: 1.1, nm: 1.35, seal: 2.1 });
}

// ---------- 提督 · 亭阁 ----------
function adm(item: PlayItem, root: HTMLElement): void {
  const T = TIER.adm;
  const halo = backdrop('haloAdm', 480, 0.07, 0.4);
  const ring = octRing(122, 0.2);
  const cl = `<g opacity=".85">${cloud(T, -372, 104, 1, -1, 1.2, 0) + cloud(T, 372, 104, 1, 1, 1.3, -1.4) + cloud(T, -446, -118, 0.7, 1, 1.5, -0.7) + cloud(T, 446, -118, 0.7, -1, 1.6, -2.1)}</g>`;
  const posts = pillarPair(226, 20, -168, 206, 'post', 'fAdm', '#F4DCFF', 0.3) + base([[228, 262, 2.2], [242, 290, 1.4], [256, 318, 1]], 0.45, 'mAdm');
  root.append(lay(`${halo}${cl}${posts}${ring}`));
  root.append(avatarEl(item.viewer, 244, 0.9, 3));
  const lintel = `<g class="rx-grow" style="--d:.95s"><rect x="-246" y="-186" width="492" height="15" fill="#240A2A"/><rect x="-246" y="-186" width="492" height="15" fill="url(#huiwen)"/><path d="M-248 -188 H248" stroke="url(#mAdm)" stroke-width="2.6"/><path d="M-248 -169 H248" stroke="url(#mAdm)" stroke-width="2"/></g>`;
  const queti = `<g class="rx-f" style="--d:1.2s"><path d="M-226 -167 Q-196 -167 -176 -180 L-226 -180Z M226 -167 Q196 -167 176 -180 L226 -180Z" fill="url(#fAdm)" stroke="rgba(255,244,214,.6)" stroke-width=".8"/></g>`;
  const roof = pavilion(1.1);
  const flash = `<circle cx="0" cy="-322" r="70" fill="url(#gFlash)" class="rx-flash" style="--d:2.3s"/>`;
  root.append(lay(`${queti}${lintel}${roof}${flash}${tassel(-282, -246, 40, '#6A2C72', 1.8, 'pAdm')}${tassel(282, -246, 40, '#6A2C72', 1.8, 'pAdm')}${sweep(posts + ring + lintel + roof + cl, 3.1)}`));
  root.append(...glints([[0, -372, 22, 3.3], [-460, 50, 20, 2.8], [460, 50, 20, 3], [-282, -214, 16, 3.6], [282, -214, 16, 3.9]]), ...dusts(16, T.dust, 340, 1.2, 4.5));
  texts(root, item, T, 'adm', 300, { lab: 1.7, nm: 2, seal: 3 });
}

// ---------- 总督 · 金銮 ----------
function gov(item: PlayItem, root: HTMLElement): void {
  const T = TIER.gov;
  const bg = backdrop('halo', 520, 0.08, 0.4);
  const roof = palaceRoof(1.25);
  const star = `<g class="rx-star" style="--d:2.6s"><path d="${STAR(0, -292, 22)}" fill="#FFF8E6"/></g><circle cx="0" cy="-292" r="80" fill="url(#gFlash)" class="rx-flash" style="--d:3.6s"/>`;
  const pillar = (side: number) => {
    const x = side < 0 ? -226 : 208;
    const cx = x + 9;
    return (
      `<g class="rx-pillar" style="--d:.3s"><rect x="${x}" y="-176" width="18" height="388" fill="url(#pillar)"/><path d="M${x + 5} -168 V206" stroke="#FFD2B8" stroke-width="1.2" opacity=".35"/>` +
      `<rect x="${x - 6}" y="-188" width="30" height="14" rx="2" fill="url(#fGov)"/><rect x="${x - 6}" y="-176" width="30" height="3" fill="rgba(60,30,4,.6)"/>` +
      `<path d="M${cx - 18} 212 h36 l5 14 h-46z" fill="url(#fGov)"/><ellipse cx="${cx}" cy="228" rx="26" ry="5" fill="url(#fGov)"/></g>`
    );
  };
  const queti = `<g class="rx-f" style="--d:1.3s"><path d="M-208 -174 Q-176 -174 -156 -186 L-208 -186Z M208 -174 Q176 -174 156 -186 L208 -186Z" fill="url(#fGov)" stroke="rgba(255,244,214,.6)" stroke-width=".8"/></g>`;
  const lintel = `<g class="rx-grow" style="--d:1.05s"><rect x="-250" y="-201" width="500" height="16" fill="url(#huiwen)"/><path d="M-252 -203 H252" stroke="url(#mGov)" stroke-width="2.6"/><path d="M-252 -183 H252" stroke="url(#mGov)" stroke-width="2.2"/></g>`;
  const gate = royalRing('gov', 130, 0.6);
  const cl = cloud(T, -340, 96, 1.3, -1, 1.5, 0) + cloud(T, 340, 96, 1.3, 1, 1.6, -1.5) + cloud(T, -420, -110, 0.85, 1, 1.8, -0.8) + cloud(T, 420, -110, 0.85, -1, 1.9, -2.2);
  const back = `${pillar(-1)}${pillar(1)}${base([[232, 262, 2.4], [246, 290, 1.5], [260, 318, 1]], 0.5, 'mGov')}${gate}`;
  root.append(lay(`${bg}${cl}${back}`));
  root.append(avatarEl(item.viewer, 260, 1.3, 4.6));
  const front = `${queti}${lintel}${roof}`;
  root.append(lay(`${front}${star}${tassel(-338, -230, 50, '#C0392B', 2, 'pGov')}${tassel(338, -230, 50, '#C0392B', 2, 'pGov')}${sweep(back + front + cl, 4.4)}`));
  root.append(...glints([[0, -330, 26, 4.1], [-440, 20, 22, 3.2], [440, 20, 22, 3.5], [-330, 260, 20, 3.8], [330, 260, 20, 4.2]]), ...dusts(22, T.dust, 360, 1.5, 6));
  texts(root, item, T, 'gov', 304, { lab: 2.5, nm: 2.9, seal: 4 });
}

const BUILD = { cap, adm, gov };

/** 生成一个宫廷特效（铺满画布，特效中心按位置放在偏上 / 居中 / 偏下） */
export function buildRoyal(item: PlayItem, tier: RoyalTier, stage: { width: number; height: number; fxz?: number }): HTMLElement {
  ensureDefs();
  const landscape = stage.width > stage.height;
  // 竖屏按 1080×1920 设计；横屏高度不够，再缩小一些并放在正中
  const zoom = (stage.fxz ?? Math.min(1, Math.min(stage.width, stage.height) / 1080)) * (landscape ? 0.72 : 1);
  const body = el('div', `rx-body t-${tier}`, { '--dur': `${item.effect.durationMs}ms` }, el('div', 'rx-dim', null));
  BUILD[tier](item, body);
  const hero = el('div', 'rx-hero', { '--hy': `${landscape ? 50 : HERO_Y[item.effect.position]}%`, '--rz': String(zoom) }, body);
  return el('div', 'fx fx-royal', null, hero);
}
