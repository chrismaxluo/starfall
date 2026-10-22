// 弹幕列表主题外观的图形：气泡、头像框、身份装饰、小八表情和小动作怎么挑。都是拼 SVG 字符串，不碰 DOM（方便测试）。
// 设计见 design/preview/chat-looks-v2.html。五种外观共用同一个「小八脑袋」：头像框是小八的脑袋（两只圆润的小三角耳朵 +
// 头顶一片蓝，中间偏左留一个往上的白尖），气泡右上角是小八的头顶。奶油贴纸选「格子花边」时用素材包的框和猫耳。
// 像素外观要把矢量形状变成格子，需要判断点在不在路径里：由调用方传进来（InPath），测试里可以换成假的

export type ThemeLook = 'jelly' | 'porcelain' | 'cream' | 'night' | 'pixel';
/** 身份：n 普通观众，1 总督、2 提督、3 舰长，anchor 主播 */
export type Tier = 'n' | 1 | 2 | 3 | 'anchor';
/** 给一条 SVG 路径，返回「某个点在不在里面」的判断函数 */
export type InPath = (d: string) => (x: number, y: number) => boolean;

export const f = (n: number) => +n.toFixed(2);
export const SV = (vb: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`;
export const svgUrl = (s: string) => `data:image/svg+xml,${encodeURIComponent(s)}`;

/** 固定种子的随机数（同一条弹幕重画时星点位置不变） */
export function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ================= 小八：按弹幕内容挑表情，每个表情配一个小动作 =================
/** [表情, 匹配, 动作]；从上往下，先对上的先用 */
export const CATS: Array<[id: string, re: RegExp, act: string]> = [
  ['laughing', /哈{3,}|h{4,}|笑死|笑疯|233/i, 'shake'],
  ['grin', /哈哈|嘿嘿嘿|笑/, 'shake'],
  ['crying', /呜呜|哭|555|泪奔|委屈|难过|伤心/, 'shiver'],
  ['touched', /感动|泪目|破防|好暖|心疼/, 'pulse'],
  ['shocked', /卧槽|我靠|震惊|啊[？?]|什么[!！]/, 'jump'],
  ['awkward', /尴尬|汗|囧|社死/, 'sink'],
  ['exhausted', /无语|…|\.{3}|寄了|麻了|好累|累死/, 'droop'],
  ['pouting', /气死|哼|生气|可恶/, 'puff'],
  ['smug', /嘿嘿|懂了|好家伙|稳了/, 'tilt'],
  ['shy', /害羞|羞|脸红|嘤|夸我/, 'shy'],
  ['sleepy', /困|睡觉|晚安|好晚|熬夜/, 'nod'],
  ['heart', /喜欢|爱你|比心|❤|♥/, 'pulse'],
  ['flower', /花/, 'sway'],
  ['cheer', /加油|冲|干巴爹|fighting/i, 'hop2'],
  ['stareyes', /好看|好美|好帅|好可爱|厉害|牛/, 'hop'],
  ['puzzled', /[？?]|为什么|怎么/, 'tilt2'],
  ['surprise', /哇|[!！]|欸/, 'jump'],
  ['greet', /晚上好|早上好|来了|打卡/, 'hop'],
];
export const CAT_IDLE = ['happy', 'wink', 'content'];
export interface CatPick { id: string; act: string; fallback: boolean }
/** idle：对不上时用第几个；fallback 为 true 表示没对上（调用方把 idle 加一）。表情包配抱爱心 */
export function pickCat(text: string, sticker: boolean, idle: number): CatPick {
  if (sticker) return { id: 'heart', act: 'pulse', fallback: false };
  for (const [id, re, act] of CATS) if (re.test(text)) return { id, act, fallback: false };
  return { id: CAT_IDLE[idle % CAT_IDLE.length]!, act: 'hop', fallback: true };
}
/** 小动作：[关键帧（进度, transform）…], 时长 */
const ACTS: Record<string, [Array<[number, string]>, number]> = {
  shake: [[[0, 'rotate(0)'], [0.15, 'rotate(-8deg)'], [0.32, 'rotate(7deg)'], [0.5, 'rotate(-6deg)'], [0.68, 'rotate(5deg)'], [0.84, 'rotate(-2deg)'], [1, 'rotate(0)']], 700],
  shiver: [[[0, 'none'], [0.12, 'translate(-2px,3px)'], [0.24, 'translate(2px,3px)'], [0.36, 'translate(-2px,3px)'], [0.48, 'translate(2px,3px)'], [0.6, 'translate(-1px,3px)'], [1, 'none']], 760],
  pulse: [[[0, 'none'], [0.2, 'scale(1.12)'], [0.4, 'scale(.98)'], [0.6, 'scale(1.08)'], [1, 'none']], 760],
  jump: [[[0, 'none'], [0.18, 'translateY(4%) scale(1.06,.92)'], [0.45, 'translateY(-20%) scale(.96,1.06)'], [0.72, 'translateY(2%) scale(1.05,.95)'], [1, 'none']], 640],
  sink: [[[0, 'none'], [0.3, 'translateY(7%) rotate(-5deg)'], [0.75, 'translateY(7%) rotate(-5deg)'], [1, 'none']], 1000],
  droop: [[[0, 'none'], [0.35, 'translateY(5%) rotate(-7deg)'], [0.7, 'translateY(5%) rotate(-4deg)'], [1, 'none']], 1300],
  puff: [[[0, 'none'], [0.2, 'scale(1.12,.92)'], [0.4, 'none'], [0.6, 'scale(1.1,.94)'], [1, 'none']], 640],
  tilt: [[[0, 'none'], [0.25, 'rotate(9deg)'], [0.75, 'rotate(9deg)'], [1, 'none']], 1000],
  shy: [[[0, 'none'], [0.25, 'rotate(-8deg) scale(.95)'], [0.75, 'rotate(-8deg) scale(.95)'], [1, 'none']], 1000],
  nod: [[[0, 'none'], [0.25, 'rotate(6deg)'], [0.5, 'rotate(-2deg)'], [0.75, 'rotate(5deg)'], [1, 'none']], 1500],
  tilt2: [[[0, 'none'], [0.2, 'rotate(15deg)'], [0.8, 'rotate(15deg)'], [1, 'none']], 1100],
  sway: [[[0, 'none'], [0.25, 'rotate(-7deg)'], [0.6, 'rotate(6deg)'], [1, 'none']], 900],
  hop: [[[0, 'none'], [0.2, 'scale(1.05,.94)'], [0.5, 'translateY(-10%)'], [0.8, 'scale(1.03,.97)'], [1, 'none']], 560],
  hop2: [[[0, 'none'], [0.15, 'translateY(-10%)'], [0.3, 'scale(1.04,.95)'], [0.5, 'translateY(-12%)'], [0.7, 'scale(1.04,.95)'], [1, 'none']], 760],
};
export function actKeyframes(name: string): [Keyframe[], number] {
  const [kf, dur] = ACTS[name] ?? ACTS['hop']!;
  return [kf.map(([offset, transform]) => ({ offset, transform })), dur];
}
export type FxKind = 'heart' | 'star' | 'spark' | 'gold' | 'purple' | 'blue' | 'bang';
/** 做小动作时顺带撒一点什么（爱心、星星、感叹号） */
export const ACT_FX: Record<string, FxKind> = { pulse: 'heart', hop: 'spark', hop2: 'star', jump: 'bang', sway: 'heart', shake: 'spark' };

// ================= 尺寸（k = 字号倍数） =================
/** 素材包的格子花边框：宽 420、高 401，圆洞中心 (209.6, 196.2)，直径 263.7（按比例用，图片实际是 320 宽） */
const LACE = { W: 420, H: 401, cx: 209.6, cy: 196.2, hole: 263.7 };
/** 画出来的框（小八脑袋）都在 150×150 里：洞的中心 (75, 80)，半径 44 */
export const FR = { cx: 75, cy: 80, R: 44 };
export interface Geo {
  /** 框的宽高 */
  F: number; FH: number;
  /** 洞的中心、半径；头像窗口的半径（比洞大一点，藏在框下面） */
  hx: number; hy: number; hr: number; wr: number;
  /** 气泡左端藏在框下面多少 */
  lap: number;
  /** 小八：平时坐的位置（中心、边长），进场时放大到框中间的位置和边长 */
  ccx: number; ccy: number; sts: number; bcx: number; bcy: number; big: number;
}
/** lace：奶油贴纸用格子花边框；right：放在右边（小八坐在头像左下角，朝着气泡） */
export function geo(k: number, lace: boolean, right: boolean): Geo {
  let F: number, FH: number, hx: number, hy: number, hr: number;
  if (lace) { F = 132 * k; FH = (F * LACE.H) / LACE.W; hx = (F * LACE.cx) / LACE.W; hy = (FH * LACE.cy) / LACE.H; hr = (F * LACE.hole) / (2 * LACE.W); }
  else { const s = ((132 * LACE.hole) / (2 * LACE.W) / FR.R) * k; F = FH = 150 * s; hx = FR.cx * s; hy = FR.cy * s; hr = FR.R * s; }
  const m = right ? -1 : 1, sts = hr * 1.8;
  return { F, FH, hx, hy, hr, wr: hr * 1.03, lap: hx, ccx: hx + m * hr * 0.9, ccy: hy + hr * 0.62, sts, bcx: hx, bcy: hy + hr * 0.06, big: hr * 2.15 };
}

// ================= 共用的小形状 =================
export function starPts(cx: number, cy: number, R: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) { const rr = i % 2 ? r : R, a = -Math.PI / 2 + (i * Math.PI) / 5; p.push(`${f(cx + rr * Math.cos(a))},${f(cy + rr * Math.sin(a))}`); }
  return p.join(' ');
}
/** 四角星（柔和的弧边） */
export const spark4 = (x: number, y: number, r: number, c: string) => { const q = r * 0.13; return `<path d="M${f(x)},${f(y - r)} Q${f(x + q)},${f(y - q)} ${f(x + r)},${f(y)} Q${f(x + q)},${f(y + q)} ${f(x)},${f(y + r)} Q${f(x - q)},${f(y + q)} ${f(x - r)},${f(y)} Q${f(x - q)},${f(y - q)} ${f(x)},${f(y - r)}Z" fill="${c}"/>`; };
const HEART = 'M20 33 C8 25 2 18 2 11 C2 5.5 6.5 2 11 2 C15 2 18 4.5 20 8 C22 4.5 25 2 29 2 C33.5 2 38 5.5 38 11 C38 18 32 25 20 33Z';
/** 小八的尾巴：从气泡右下角后面伸出来往上卷（64×76） */
const TAIL_D = 'M8 62 C30 64 47 52 48 32 C49 20 44 12 37 10';
const PAW = { toes: [[10, 15, 6.2], [19.5, 9, 6.4], [30, 9, 6.4], [39, 15, 6.2]] as Array<[number, number, number]>, pad: [24.5, 29, 13, 11] as [number, number, number, number] };
export const polar = (a: number, r: number): [number, number] => [FR.cx + Math.cos((a * Math.PI) / 180) * r, FR.cy + Math.sin((a * Math.PI) / 180) * r];
/** 月牙：外圆减内圆，算出两圆交点画成一条路径 */
function crescentPath(cx: number, cy: number, r1: number, dx: number, dy: number, r2: number): string {
  const d = Math.hypot(dx, dy), a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const ux = dx / d, uy = dy / d, x = cx + ux * a, y = cy + uy * a;
  return `M${f(x - uy * hh)},${f(y + ux * hh)} A${r1},${r1} 0 1 1 ${f(x + uy * hh)},${f(y - ux * hh)} A${r2},${r2} 0 0 0 ${f(x - uy * hh)},${f(y + ux * hh)} Z`;
}

// ================= 气泡外形 =================
// 身体 (x0,y0)–(x0+w,y0+h)，左端藏在头像框下面；ears 是插在上沿的一段路径（小八头顶或格子花边的两只猫耳）
interface Ear { cx: number; lean: number; w: number; h: number; y: number }
function earsOf(x1: number, y0: number, R: number, k: number): Ear[] {
  const c2 = x1 - R * 0.85 - 14 * k, c1 = c2 - 46 * k;
  return [{ cx: c1, lean: -3.5 * k }, { cx: c2, lean: 3.5 * k }].map((e) => ({ ...e, w: 40 * k, h: 25 * k, y: y0 }));
}
function earSeg(e: Ear, s = 1, dy = 0): string {
  const w = e.w * s, h = e.h * s, y = e.y + dy, tx = e.cx + e.lean * s, ty = y - h;
  return `L${f(e.cx - w / 2)},${f(y)} C${f(e.cx - w * 0.3)},${f(y - h * 0.55)} ${f(tx - w * 0.16)},${f(ty)} ${f(tx)},${f(ty)} C${f(tx + w * 0.16)},${f(ty)} ${f(e.cx + w * 0.3)},${f(y - h * 0.55)} ${f(e.cx + w / 2)},${f(y)}`;
}
export function bodyPath(x0: number, y0: number, w: number, h: number, R: number, rl: number, ears: string | null): string {
  const x1 = x0 + w, y1 = y0 + h;
  return `M${f(x0 + rl)},${f(y0)} ${ears ?? ''} L${f(x1 - R)},${f(y0)} A${f(R)},${f(R)} 0 0 1 ${f(x1)},${f(y0 + R)} L${f(x1)},${f(y1 - R)} A${f(R)},${f(R)} 0 0 1 ${f(x1 - R)},${f(y1)} L${f(x0 + rl)},${f(y1)} A${f(rl)},${f(rl)} 0 0 1 ${f(x0)},${f(y1 - rl)} L${f(x0)},${f(y0 + rl)} A${f(rl)},${f(rl)} 0 0 1 ${f(x0 + rl)},${f(y0)} Z`;
}
/** 气泡右上角的圆角半径 */
export const bubbleR = (h: number, k: number) => Math.min(h * 0.42, 42 * k);
export interface HachiHead { seg: string; fill: string; line: string; cap: string }
/**
 * 小八的脑袋顶（照着表情图描的）：气泡右上角就是小八的头顶。
 * 耳朵是圆润的小三角，耳尖往外斜，外侧陡、内侧缓缓落回头顶；蓝色只占文字上方一小条（不压在昵称下面，字的对比度才够），
 * 两耳中间偏左留一个往上的白尖（「八」字），最右边没有字的地方再顺着边往下垂。蓝色和白色之间不描线
 */
export function hachiHead(x1: number, y0: number, R: number, k: number): HachiHead {
  const h = 21 * k, rt = 4.6 * k;
  const ear = (bx0: number, bx1: number, tx: number) => [
    `L${f(bx0)},${f(y0)} C${f(bx0 + (tx - bx0) * 0.3)},${f(y0 - h * 0.28)} ${f(tx - (tx - bx0) * 0.42)},${f(y0 - h * 0.9)} ${f(tx - rt)},${f(y0 - h + rt * 0.55)}`,
    `C${f(tx - rt * 0.45)},${f(y0 - h - rt * 0.15)} ${f(tx + rt * 0.45)},${f(y0 - h - rt * 0.15)} ${f(tx + rt)},${f(y0 - h + rt * 0.55)} C${f(tx + (bx1 - tx) * 0.42)},${f(y0 - h * 0.9)} ${f(bx1 - (bx1 - tx) * 0.3)},${f(y0 - h * 0.28)} ${f(bx1)},${f(y0)}`,
  ].join(' ');
  const xr = x1 - R, eL = ear(xr - 92 * k, xr - 56 * k, xr - 80 * k), eR = ear(xr - 34 * k, xr, xr - 12 * k);
  const cl = xr - 104 * k, Y = (v: number) => f(y0 + v * k), X = (v: number) => f(cl + v * k), xs = x1 - 64 * k;
  const cap = `M${X(0)},${Y(-2)} C${X(5)},${Y(6)} ${X(15)},${Y(10)} ${X(30)},${Y(10)} C${X(42)},${Y(10)} ${X(49)},${Y(4)} ${X(57)},${Y(4)} C${X(66)},${Y(4)} ${X(72)},${Y(10.5)} ${X(84)},${Y(11)} L${f(xs)},${Y(11.5)} C${f(xs + 26 * k)},${Y(12)} ${f(x1 - 16 * k)},${Y(24)} ${f(x1 - 8 * k)},${Y(40)} L${f(x1 + 4 * k)},${Y(50)} L${f(x1 + 4 * k)},${Y(-4)} Z`;
  const close = (e: string, bx0: number, bx1: number) => `M${f(bx0)},${f(y0 + 2 * k)} ${e} L${f(bx1)},${f(y0 + 2 * k)} Z`;
  return { seg: `${eL} ${eR}`, fill: `${close(eL, xr - 92 * k, xr - 56 * k)} ${close(eR, xr - 34 * k, xr)}`, line: `${eL.replace(/^L/, 'M')} ${eR.replace(/^L/, 'M')}`, cap };
}
/** 小八脑袋框的耳朵和头顶蓝色（150×150 坐标），矢量框和像素框共用 */
export function hachiFramePaths(): { ears: string[]; cap: string; r1: number } {
  const { R } = FR, r1 = R + 12.5, P = (a: number, r: number) => polar(a, r).map(f).join(',');
  // 外侧长弧线从圆圈上升起，耳尖圆、往外斜，内侧短、陡陡落回圈上；右耳是左耳翻过来
  const earL = (m: number) => {
    const Q = (a: number, r: number) => P(m < 0 ? -180 - a : a, r);
    return `M${Q(-161, r1 - 3)} C${Q(-157, r1 + 8)} ${Q(-147, r1 + 16)} ${Q(-139.5, r1 + 17.5)} C${Q(-136, r1 + 20.8)} ${Q(-130, r1 + 20.8)} ${Q(-127, r1 + 16.5)} C${Q(-122, r1 + 11)} ${Q(-117, r1 + 4)} ${Q(-112, r1 - 3)} Z`;
  };
  // 头顶的蓝色：两侧斜着收进去，中间偏左留一个往上的白尖，右边的蓝多一点
  const cap = `M${P(-176, R)} Q${P(-178, r1 - 1)} ${P(-168, r1)} A${r1},${r1} 0 0 1 ${P(-6, r1)} Q${P(4, r1 - 2)} ${P(0, R)} A${R},${R} 0 0 0 ${P(-82, R)} C${P(-86, R + 3)} ${P(-92, r1 - 3.5)} ${P(-99, r1 - 4)} C${P(-106, r1 - 3.5)} ${P(-111, R + 2)} ${P(-116, R)} A${R},${R} 0 0 0 ${P(-176, R)} Z`;
  return { ears: [earL(1), earL(-1)], cap, r1 };
}

// ================= 配色 =================
/** 奶油贴纸：格子、缝线、格子花边框（图片）按身份换 */
const CREAM: Record<Tier, { g0: string; g1: string; st: string; frame: string }> = {
  n: { g0: '#E3EDFC', g1: '#8FB4EE', st: '#93B5EC', frame: 'frame' },
  3: { g0: '#DDE9FF', g1: '#6E9FF0', st: '#7DA6EE', frame: 'frame' },
  2: { g0: '#EEE6FF', g1: '#A88BEA', st: '#AE95EC', frame: 'frame-lv2' },
  1: { g0: '#FFF2CF', g1: '#EDB54A', st: '#E9B656', frame: 'frame-lv1' },
  anchor: { g0: '#FFE6EF', g1: '#F49AB8', st: '#F3A3BF', frame: 'frame-anchor' },
};
export const laceFrameName = (tier: Tier) => CREAM[tier].frame;
/** 奶油贴纸的小八脑袋（耳朵、头顶） */
const HT: Record<Tier, { main: string; light: string }> = {
  n: { main: '#6AA6F0', light: '#BFD9FA' }, 3: { main: '#5B97F2', light: '#BFD6FF' }, 2: { main: '#A58BEA', light: '#DDD0FF' },
  1: { main: '#F2B84B', light: '#FFE6A8' }, anchor: { main: '#F49AB8', light: '#FFD6E4' },
};
/** 星月夜空 */
const NT: Record<Tier, { main: string; light: string; deep: string }> = {
  n: { main: '#6F8BFF', light: '#C3D1FF', deep: '#3346C0' },
  3: { main: '#4F9DFF', light: '#C2E2FF', deep: '#1F57C8' },
  2: { main: '#A57CFF', light: '#E6D8FF', deep: '#5A30C2' },
  1: { main: '#FFC24D', light: '#FFF0C0', deep: '#C98A1C' },
  anchor: { main: '#FF7FB0', light: '#FFD7E7', deep: '#C2457A' },
};
export const nightLight = (tier: Tier) => NT[tier].light;
export const nightMain = (tier: Tier) => NT[tier].main;
/** 像素小屋 */
const PT: Record<Tier, { main: string; light: string; deep: string }> = {
  n: { main: '#4A7BFF', light: '#A9C8FF', deep: '#2A49B8' },
  3: { main: '#3D86F5', light: '#BFDBFF', deep: '#1D4A9E' },
  2: { main: '#9B6CF0', light: '#E2D2FF', deep: '#4E2A99' },
  1: { main: '#F0A925', light: '#FFE6A6', deep: '#9A6108' },
  anchor: { main: '#F06E9C', light: '#FFD3E2', deep: '#9C2D57' },
};
/** 青花瓷：钴蓝；提督、总督「描金」 */
const PCT: Record<Tier, { main: string; wash: string; deep: string; trim?: string; gilt?: boolean }> = {
  n: { main: '#2D5DB5', wash: '#7C9DDB', deep: '#1B3F8F' },
  3: { main: '#2D5DB5', wash: '#7C9DDB', deep: '#1B3F8F' },
  2: { main: '#4C4AB2', wash: '#9C98E0', deep: '#2F2C86', trim: '#C9A24A' },
  1: { main: '#1F4596', wash: '#7290D2', deep: '#132E6E', trim: '#D4AF55', gilt: true },
  anchor: { main: '#B8456A', wash: '#E39AB2', deep: '#8A2C4C' },
};
export const porcelainTrim = (tier: Tier) => PCT[tier].trim;
/** 果冻玻璃：身份只换边缘光 */
export const JT: Record<Tier, string> = { n: '#FFFFFF', 3: '#8EC5FF', 2: '#C3A6FF', 1: '#FFD772', anchor: '#FFA6CB' };
/** 小八蓝果冻：上浅下深 */
const JB = ['#AEDBFF', '#5AA8F8', '#3A84EC'] as const;
const SEAL = '#C4373D';
const PIX_DARK = '#0B1433';

// ================= 小图 =================
/** 五角星贴纸：白边 + 深色描边 + 一点高光 */
const starSvg = (c: string) => { const p = starPts(24, 25, 20, 9.5); return SV('0 0 48 48', `<polygon points="${p}" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round"/><polygon points="${p}" fill="${c}" stroke="#2A3366" stroke-width="2.6" stroke-linejoin="round"/><path d="M17 19l3-1" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>`); };
function crownSvg(): string {
  const d = 'M8 34 L5 12 L16 21 L25 5 L34 21 L45 12 L42 34 Z';
  const bead = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFCC4D" stroke="#2A3366" stroke-width="1.6"/>`;
  return SV('0 0 50 40', `<path d="${d}" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/><path d="${d}" fill="#FFCC4D" stroke="#2A3366" stroke-width="2.6" stroke-linejoin="round"/><path d="M9 31h32" stroke="#E89B1E" stroke-width="4"/><path d="M12 14l2 9" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/><circle cx="25" cy="27" r="3.4" fill="#FF6F9E"/><circle cx="15" cy="28" r="2.3" fill="#6FB6FF"/><circle cx="35" cy="28" r="2.3" fill="#6FB6FF"/>${bead(5, 12, 2.6)}${bead(25, 5, 2.8)}${bead(45, 12, 2.6)}`);
}
const heartSvg = (c: string) => SV('0 0 40 36', `<path d="${HEART}" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><path d="${HEART}" fill="${c}" stroke="#2A3366" stroke-width="2.2" stroke-linejoin="round"/><path d="M9 9q2-3 5-2" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".9"/>`);
const sparkSvg = (c: string) => SV('0 0 20 20', `<path d="M10 0 Q11.2 8.8 20 10 Q11.2 11.2 10 20 Q8.8 11.2 0 10 Q8.8 8.8 10 0Z" fill="${c}"/><circle cx="10" cy="10" r="2.2" fill="#fff"/>`);
const bangSvg = () => SV('0 0 20 40', `<path d="M6 3h8l-2 22h-4z" fill="#FFD45E" stroke="#2A3366" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="33" r="4" fill="#FFD45E" stroke="#2A3366" stroke-width="2"/>`);
const creamTailSvg = () => SV('0 0 64 76', `<path d="${TAIL_D}" fill="none" stroke="#fff" stroke-width="19" stroke-linecap="round"/><path d="${TAIL_D}" fill="none" stroke="#25306A" stroke-width="14.5" stroke-linecap="round"/><path d="${TAIL_D}" fill="none" stroke="#5E9BEA" stroke-width="10" stroke-linecap="round"/><path d="M44 36 C45 26 42 19 38 16" fill="none" stroke="#B9D7FF" stroke-width="3" stroke-linecap="round"/>`);
// 星月夜空：都带一圈柔光，不描深色边
const nSparkSvg = (c: string) => SV('-6 -6 32 32', `<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter></defs><g filter="url(#g)" opacity=".9">${spark4(10, 10, 10, c)}</g>${spark4(10, 10, 9, c)}${spark4(10, 10, 5.5, '#FFFDF0')}<circle cx="10" cy="10" r="1.8" fill="#fff"/>`);
const nStarSvg = (c: string) => SV('-6 -6 60 60', `<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter><radialGradient id="s" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#FFFBEA"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="#E9A23A"/></radialGradient></defs><polygon points="${starPts(24, 25, 21, 10)}" fill="${c}" filter="url(#g)" opacity=".9"/><polygon points="${starPts(24, 25, 20, 9.5)}" fill="url(#s)" stroke="#FFF4CF" stroke-width="1.6" stroke-linejoin="round"/>`);
const nHeartSvg = (c: string) => SV('-6 -6 52 48', `<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs><path d="${HEART}" fill="${c}" filter="url(#g)" opacity=".85"/><path d="${HEART}" fill="${c}" stroke="#FFE3EE" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 9q2-3 5-2" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".9"/>`);
function nCrownSvg(): string {
  const d = 'M8 34 L5 12 L16 21 L25 5 L34 21 L45 12 L42 34 Z';
  return SV('-6 -6 62 52', `<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF3C4"/><stop offset=".6" stop-color="#FFD25E"/><stop offset="1" stop-color="#E9A23A"/></linearGradient></defs><path d="${d}" fill="#FFC24A" filter="url(#g)"/><path d="${d}" fill="url(#c)" stroke="#FFF4CF" stroke-width="1.6" stroke-linejoin="round"/><circle cx="25" cy="27" r="3.4" fill="#FF6F9E"/><circle cx="15" cy="28" r="2.3" fill="#8FC8FF"/><circle cx="35" cy="28" r="2.3" fill="#8FC8FF"/>`);
}
function nPawSvg(main: string): string {
  const shapes = (ex: number) => PAW.toes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + ex}"/>`).join('') + `<ellipse cx="${PAW.pad[0]}" cy="${PAW.pad[1]}" rx="${PAW.pad[2] + ex}" ry="${PAW.pad[3] + ex}"/>`;
  const pads = PAW.toes.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y + 0.6}" rx="${r * 0.5}" ry="${r * 0.58}"/>`).join('') + '<path d="M17,33 Q16.5,24 24.5,24.5 Q32.5,24 32,33 Q24.5,37 17,33Z"/>';
  return SV('-8 -8 64 60', `<defs><filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.2"/></filter></defs><g fill="${main}" filter="url(#g)" opacity=".9">${shapes(3)}</g><g fill="#DCE6FF">${shapes(1.6)}</g><g fill="#fff">${shapes(0)}</g><g fill="#FF9DBF">${pads}</g>`);
}
function nMoonSvg(): string {
  const beads = [2, 6, 10, 17, 21].map((y) => `<circle cx="13" cy="${y}" r="1.1" fill="#FFE7A8"/>`).join('');
  return SV('-8 -2 42 52', `<defs><filter id="g" x="-80%" y="-40%" width="260%" height="180%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <radialGradient id="m" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#FFF6D2"/><stop offset=".6" stop-color="#FFDC86"/><stop offset="1" stop-color="#F2B850"/></radialGradient>
    <mask id="c"><circle cx="13" cy="34" r="10" fill="#fff"/><circle cx="17.5" cy="30" r="8.6" fill="#000"/></mask></defs>
    ${beads}${spark4(13, 13.5, 4, '#FFF2C4')}<circle cx="13" cy="34" r="10" fill="#FFD27A" mask="url(#c)" filter="url(#g)" opacity=".95"/><circle cx="13" cy="34" r="10" fill="url(#m)" mask="url(#c)"/>`);
}
const nTailSvg = (T: { main: string; light: string; deep: string }) => SV('-10 -10 84 96', `<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter><linearGradient id="t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${T.deep}"/><stop offset=".55" stop-color="${T.main}"/><stop offset="1" stop-color="${T.light}"/></linearGradient></defs>
  <path d="${TAIL_D}" fill="none" stroke="${T.main}" stroke-width="20" stroke-linecap="round" filter="url(#g)" opacity=".8"/><path d="${TAIL_D}" fill="none" stroke="#0C1240" stroke-width="14.5" stroke-linecap="round"/>
  <path d="${TAIL_D}" fill="none" stroke="url(#t)" stroke-width="10" stroke-linecap="round"/><path d="M46.5 24 C46 17 42 12.5 37 10" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>`);
/** 描光：一颗亮点拖着光尾，沿着头像框转一圈（星月夜空进场） */
export function traceSvg(c: string): string {
  let segs = '';
  for (let i = 0; i < 24; i++) {
    const a0 = ((-90 - (i + 1) * 6 - 1) * Math.PI) / 180, a1 = ((-90 - i * 6) * Math.PI) / 180, t = 1 - i / 24;
    segs += `<path d="M${f(50 + 46.5 * Math.cos(a0))},${f(50 + 46.5 * Math.sin(a0))} A46.5,46.5 0 0 1 ${f(50 + 46.5 * Math.cos(a1))},${f(50 + 46.5 * Math.sin(a1))}" stroke-opacity="${f(t ** 1.8)}" stroke-width="${f(1 + 4 * t)}"/>`;
  }
  return SV('0 0 100 100', `<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs><g fill="none" stroke="${c}" filter="url(#g)">${segs.replace(/stroke-width="[\d.]+"/g, 'stroke-width="9"')}</g><g fill="none" stroke="${c}">${segs}</g><g fill="none" stroke="#fff" opacity=".9">${segs.replace(/stroke-width="([\d.]+)"/g, (_m, w: string) => `stroke-width="${f(+w * 0.45)}"`)}</g><circle cx="50" cy="3.5" r="7" fill="${c}" filter="url(#g)"/><circle cx="50" cy="3.5" r="3.4" fill="#fff"/>`);
}
/** 流星（星月夜空大航海进场） */
export const meteorSvg = (c: string) => SV('0 0 160 16', `<defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".75" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="#fff"/></linearGradient><filter id="g" x="-10%" y="-100%" width="120%" height="300%"><feGaussianBlur stdDeviation="2.2"/></filter></defs><path d="M2 8 L150 5.2 A2.8 2.8 0 0 1 150 10.8 Z" fill="url(#m)" filter="url(#g)"/><path d="M30 8 L150 6.6 A1.4 1.4 0 0 1 150 9.4 Z" fill="url(#m)"/><circle cx="150" cy="8" r="5.5" fill="${c}" filter="url(#g)"/><circle cx="150" cy="8" r="2.6" fill="#fff"/>`);
// 像素小图：字符画 → 一格一格的方块
function pixRects(rows: string[], pal: Record<string, string>): string {
  let r = '';
  rows.forEach((line, y) => { let x = 0; while (x < line.length) { const ch = line[x]!; let n = 1; while (line[x + n] === ch) n++; if (pal[ch]) r += `<rect x="${x}" y="${y}" width="${n + 0.02}" height="1.02" fill="${pal[ch]}"/>`; x += n; } });
  return `<g shape-rendering="crispEdges">${r}</g>`;
}
const pixSvg = (rows: string[], pal: Record<string, string>) => SV(`0 0 ${rows[0]!.length} ${rows.length}`, pixRects(rows, pal));
const PIX_STAR = ['....o....', '...oYo...', '...oYo...', 'ooooYoooo', 'oYYYWYYYo', '.oYYYYYo.', '..oYYYo..', '.oYYoYYo.', '.oYo.oYo.', '.oo...oo.'];
const PIX_PLUS = ['..Y..', '..Y..', 'YYWYY', '..Y..', '..Y..'];
const PIX_HEART = ['.oo.oo.', 'oPPoWPo', 'oPPPPPo', 'oPPPPPo', '.oPPPo.', '..oPo..', '...o...'];
const PIX_GEM = ['...o...', '..oWo..', '.oWLLo.', 'oWLLLBo', '.oLLBo.', '..oBo..', '...o...'];
const PIX_MOON = ['..ooo..', '.oYYo..', 'oYYo...', 'oYYo...', 'oYYo...', 'oYYYo.o', '.oYYYYo', '..oooo.'];
const PIX_PAW = ['.oo..ooo..oo.', 'oWWooWWWooWWo', 'oWPWoWPWoWPWo', 'oWWWoWWWoWWWo', '.ooWWWWWWWoo.', '.oWWWPPPWWWo.', 'oWWWPPPPPWWWo', 'oWWPPPPPPPWWo', 'oWWWPPPPPWWWo', '.oWWWWWWWWWo.', '..ooooooooo..'];
const PIX_TAIL = ['.........ooo..', '........oWWWo.', '.......oWWWWWo', '.......oWWWWWo', '.......oBWWWo.', '.......oBBBBo.', '......oLBBBBo.', '......oLBBBBo.', '.....oLBBBBo..', '...ooLBBBBBo..', '.ooBBBBBBBo...', 'oBBBBBBBBo....', 'oBBBBBBoo.....', '.oooooo.......'];
const PIX_CROWN = ['.o....o....o.', 'oYo..oYo..oYo', 'oYYooYRYooYYo', 'oYYYYYYYYYYYo', 'oYYBYYRYYBYYo', 'oYYYYYYYYYYYo', 'oDDDDDDDDDDDo', '.ooooooooooo.'];
const PIX_BANG = ['.oo.', 'oYYo', 'oYYo', 'oYYo', 'oYYo', '.oo.', '....', '.oo.', 'oYYo', '.oo.'];
const pixStarSvg = (y: string) => pixSvg(PIX_STAR, { o: PIX_DARK, Y: y, W: '#FFFFFF' });
const pixPlusSvg = (c: string) => pixSvg(PIX_PLUS, { Y: c, W: '#FFFFFF' });
const pixHeartSvg = (c: string) => pixSvg(PIX_HEART, { o: PIX_DARK, P: c, W: '#FFFFFF' });
const pixCrownSvg = () => pixSvg(PIX_CROWN, { o: PIX_DARK, Y: '#FFD24A', D: '#E09A1C', R: '#FF6F9E', B: '#6FB6FF' });
/** 像素吊坠：一串金色小珠子下面挂一颗星 / 爱心 / 宝石 / 月亮（轮流换，相邻两条不重复） */
const PIX_CHARMS: Array<[string[], Record<string, string>]> = [[PIX_STAR, { o: PIX_DARK, Y: '#FFD24A', W: '#FFF6D0' }], [PIX_HEART, { o: PIX_DARK, P: '#FF7FA8', W: '#FFFFFF' }], [PIX_GEM, { o: PIX_DARK, W: '#FFFFFF', L: '#8FD0FF', B: '#3D86F5' }], [PIX_MOON, { o: PIX_DARK, Y: '#FFD24A' }]];
export const PIX_CHARM_COUNT = PIX_CHARMS.length;
/** 第 i 种吊坠：[图, 格子高度] */
export function pixCharm(i: number): [string, number] {
  const [rows, pal] = PIX_CHARMS[i]!, wd = 9, pad = (wd - rows[0]!.length) >> 1;
  const all = ['....Y....', '.........', '....Y....', '.........', '....Y....', '.........', ...rows.map((r) => '.'.repeat(pad) + r + '.'.repeat(wd - pad - r.length))];
  return [pixSvg(all, { ...pal, Y: pal['Y'] ?? '#FFD24A' }), all.length];
}
// 青花瓷
function sealSvg(): string {
  const d = 'M6 3 Q20 1.5 34 3 Q37.6 3.6 37.2 7 Q38.8 20 37.4 33 Q36.8 37 33 37.2 Q20 38.8 7 37.3 Q3.2 36.8 3 33 Q1.4 20 2.8 7 Q3.2 3.4 6 3Z';
  const toes = PAW.toes.map(([x, y, r]) => `<circle cx="${f(8 + x * 0.5)}" cy="${f(9 + y * 0.5)}" r="${f(r * 0.5)}"/>`).join('');
  return SV('0 0 40 40', `<path d="${d}" fill="${SEAL}"/><path d="${d}" transform="translate(4 4) scale(.8)" fill="none" stroke="#FBE9E6" stroke-width="1.4" opacity=".8"/>
    <g fill="#FBE9E6">${toes}<ellipse cx="${f(8 + PAW.pad[0] * 0.5)}" cy="${f(9 + PAW.pad[1] * 0.5)}" rx="${f(PAW.pad[2] * 0.5)}" ry="${f(PAW.pad[3] * 0.5)}"/></g>
    <g fill="${SEAL}" opacity=".55"><circle cx="14" cy="27" r="1"/><circle cx="27" cy="12" r=".8"/><circle cx="30" cy="25" r="1.1"/></g>`);
}
const tasselSvg = (C: { main: string; wash: string }) => SV('0 0 26 66', `<path d="M13 0 V13" stroke="${C.main}" stroke-width="1.3"/>
  <rect x="7.5" y="13.5" width="11" height="11" rx="1.6" transform="rotate(45 13 19)" fill="${C.main}"/><rect x="10" y="16" width="6" height="6" rx="1" transform="rotate(45 13 19)" fill="none" stroke="#F3F6FC" stroke-width="1.1"/>
  <circle cx="13" cy="31" r="3.2" fill="${SEAL}"/><circle cx="12" cy="30" r="1" fill="#fff" opacity=".6"/>
  <path d="M10.5 34 H15.5 L18 59 Q13 62 8 59 Z" fill="${C.main}"/><path d="M11.5 36 L10.5 58 M13 36 V59 M14.5 36 L15.5 58" stroke="${C.wash}" stroke-width=".8" opacity=".9"/>`);
const porcelainTailSvg = (C: { main: string; wash: string; deep: string }) => SV('0 0 64 76', `<path d="${TAIL_D}" fill="none" stroke="${C.deep}" stroke-width="15" stroke-linecap="round"/><path d="${TAIL_D}" fill="none" stroke="${C.main}" stroke-width="11" stroke-linecap="round"/>
  <path d="M44 38 C45 28 43 20 39 15" fill="none" stroke="${C.wash}" stroke-width="3.2" stroke-linecap="round"/><path d="M46.5 24 C46 17 42 12.5 37 10" fill="none" stroke="#F6F9FE" stroke-width="9" stroke-linecap="round"/>`);
const blossomSvg = (c: string) => SV('0 0 24 24', `${[0, 90, 180, 270].map((a) => `<ellipse cx="12" cy="6.2" rx="3.6" ry="5.6" transform="rotate(${a} 12 12)" fill="${c}" opacity=".9"/>`).join('')}<circle cx="12" cy="12" r="2.6" fill="#F6F9FE"/><circle cx="12" cy="12" r="1.2" fill="${c}"/>`);
const giltSvg = (c: string) => SV('0 0 20 20', `<path d="M4 6 L13 3 L17 11 L9 17 L3 13 Z" fill="${c}"/><path d="M6 7 L12 5" stroke="#FFF4D0" stroke-width="1.4" opacity=".8"/>`);
// 果冻玻璃
const jellyTailSvg = () => SV('-6 -6 76 88', `<defs><linearGradient id="t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${JB[2]}"/><stop offset=".6" stop-color="${JB[1]}"/><stop offset="1" stop-color="${JB[0]}"/></linearGradient><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2"/></filter></defs>
  <path d="${TAIL_D}" fill="none" stroke="#06102E" stroke-opacity=".35" stroke-width="15" stroke-linecap="round" transform="translate(0 3)" filter="url(#b)"/><path d="${TAIL_D}" fill="none" stroke="#E6F3FF" stroke-opacity=".8" stroke-width="13" stroke-linecap="round"/>
  <path d="${TAIL_D}" fill="none" stroke="url(#t)" stroke-width="10.6" stroke-linecap="round"/><path d="M42 40 C45 30 43 20 38 15" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2.6" stroke-linecap="round"/>`);
const beadSvg = (c: string) => SV('0 0 20 20', `<defs><radialGradient id="g" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${c}" stop-opacity=".85"/><stop offset="1" stop-color="${c}" stop-opacity=".35"/></radialGradient></defs><circle cx="10" cy="10" r="8.6" fill="url(#g)" stroke="#fff" stroke-opacity=".7" stroke-width=".9"/><ellipse cx="7" cy="6.2" rx="2.6" ry="1.6" fill="#fff" opacity=".9" transform="rotate(-30 7 6.2)"/>`);

// ================= 每种外观的零件 =================
export interface Sprite { svg: string; px: boolean }
/** 身份装饰：舰长一颗星、提督两颗、总督皇冠；主播爱心 */
export function ornament(look: ThemeLook, kind: 'star' | 'crown' | 'heart'): Sprite {
  if (look === 'pixel') return { svg: kind === 'star' ? pixStarSvg('#FFD24A') : kind === 'crown' ? pixCrownSvg() : pixHeartSvg('#FF7FA8'), px: true };
  if (look === 'night' || look === 'jelly') return { svg: kind === 'star' ? nStarSvg('#FFD27A') : kind === 'crown' ? nCrownSvg() : nHeartSvg('#FF8DB3'), px: false };
  return { svg: kind === 'star' ? starSvg(look === 'porcelain' ? '#E9C25A' : '#FFD45E') : kind === 'crown' ? crownSvg() : heartSvg(look === 'porcelain' ? '#E77A9C' : '#FF8DB3'), px: false };
}
/** 这几种图四周留了柔光，放大一点才和别的一样大 */
export const glowScale = (look: ThemeLook) => (look === 'night' || look === 'jelly' ? 1.25 : 1);
/** 普通观众昵称前的小图标（果冻玻璃不放） */
export function nameIcon(look: ThemeLook): Sprite | null {
  if (look === 'jelly') return null;
  if (look === 'pixel') return { svg: pixStarSvg('#FFD24A'), px: true };
  if (look === 'night') return { svg: nSparkSvg('#B9CCFF'), px: false };
  if (look === 'porcelain') return { svg: blossomSvg('#2D5DB5'), px: false };
  return { svg: starSvg('#FFD45E'), px: false };
}
type Twinkle = [cls: string, sprite: Sprite, cx: number, cy: number, size: number];
/** 头像框旁边一闪一闪的小星（只有星月夜空、像素小屋有）：位置是框宽高的比例；ornate：右上已经有身份装饰 */
export function twinkles(look: ThemeLook, ornate: boolean): Twinkle[] {
  const out: Twinkle[] = [];
  if (look === 'night') {
    out.push(['t1', { svg: nSparkSvg('#FFE29A'), px: false }, 0.5, 0.06, 22]);
    if (!ornate) out.push(['t2', { svg: nSparkSvg('#E8EEFF'), px: false }, 0.97, 0.4, 15]);
  } else if (look === 'pixel') {
    if (!ornate) out.push(['t1', { svg: pixPlusSvg('#FFE7A8'), px: true }, 0.84, 0.13, 15]);
    out.push(['t2', { svg: pixPlusSvg('#A9C8FF'), px: true }, 0.08, 0.66, 12]);
  }
  return out;
}
/** 尾巴 */
export function tailSprite(look: ThemeLook, tier: Tier): Sprite {
  if (look === 'night') return { svg: nTailSvg(NT[tier]), px: false };
  if (look === 'pixel') return { svg: pixSvg(PIX_TAIL, { o: PIX_DARK, W: '#FFFFFF', B: PT[tier].main, L: PT[tier].light }), px: true };
  if (look === 'porcelain') return { svg: porcelainTailSvg(PCT[tier]), px: false };
  if (look === 'jelly') return { svg: jellyTailSvg(), px: false };
  return { svg: creamTailSvg(), px: false };
}
/** 猫爪（奶油贴纸用素材包的图，返回 null；青花瓷换成一枚朱红印章；果冻玻璃不放） */
export function pawSprite(look: ThemeLook, tier: Tier): Sprite | null {
  if (look === 'night') return { svg: nPawSvg(NT[tier].main), px: false };
  if (look === 'pixel') return { svg: pixSvg(PIX_PAW, { o: PIX_DARK, W: '#FFFFFF', P: '#FF8FB1' }), px: true };
  if (look === 'porcelain') return { svg: sealSvg(), px: false };
  return null;
}
/** 右上的吊坠：星月夜空月亮、青花瓷中国结（像素小屋用 pixCharm 轮流换） */
export function charmSprite(look: ThemeLook, tier: Tier): Sprite | null {
  if (look === 'night') return { svg: nMoonSvg(), px: false };
  if (look === 'porcelain') return { svg: tasselSvg(PCT[tier]), px: false };
  return null;
}

// ================= 进场时撒的小东西 =================
export function fxSprites(look: ThemeLook, kind: FxKind): Sprite[] {
  const s = (svg: string, px = false): Sprite => ({ svg, px });
  if (look === 'night') {
    const ns = s(nStarSvg('#FFD27A')), sp = (c: string) => s(nSparkSvg(c));
    return { heart: [s(nHeartSvg('#FF8DB3')), s(nHeartSvg('#FFB6CE'))], star: [ns, sp('#FFF2C4')], spark: [sp('#A9C4FF'), sp('#FFE29A'), sp('#FFB3D1')], gold: [ns, sp('#FFD27A'), sp('#FFF6D8')], purple: [ns, sp('#C7A8FF'), sp('#FFF6D8')], blue: [ns, sp('#9EC8FF'), sp('#FFF6D8')], bang: [s(bangSvg())] }[kind];
  }
  if (look === 'pixel') {
    const ps = s(pixStarSvg('#FFD24A'), true), pl = (c: string) => s(pixPlusSvg(c), true);
    return { heart: [s(pixHeartSvg('#FF7FA8'), true), s(pixHeartSvg('#FFB6CE'), true)], star: [ps, pl('#FFE7A8')], spark: [pl('#FFE7A8'), pl('#A9C8FF'), pl('#FFB3D1')], gold: [ps, pl('#FFD24A'), pl('#FFF6D8')], purple: [ps, pl('#D2B8FF'), pl('#FFF6D8')], blue: [ps, pl('#A9C8FF'), pl('#FFF6D8')], bang: [s(pixSvg(PIX_BANG, { o: PIX_DARK, Y: '#FFD24A' }), true)] }[kind];
  }
  if (look === 'porcelain') {
    const gl = (c: string) => s(giltSvg(c)), bl = (c: string) => s(blossomSvg(c));
    return { heart: [s(heartSvg('#E77A9C')), bl('#E77A9C')], star: [s(starSvg('#E9C25A')), bl('#2D5DB5')], spark: [bl('#2D5DB5'), bl('#7C9DDB'), gl('#E2BC5A')], gold: [gl('#E2BC5A'), gl('#F3D98A'), gl('#C99A35')], purple: [gl('#E2BC5A'), bl('#4C4AB2'), gl('#F3D98A')], blue: [bl('#2D5DB5'), bl('#7C9DDB'), gl('#E2BC5A')], bang: [s(bangSvg())] }[kind];
  }
  if (look === 'jelly') {
    const bd = (c: string) => s(beadSvg(c)), ns = s(nStarSvg('#FFD27A'));
    return { heart: [s(nHeartSvg('#FF8DB3')), bd('#FFA6CB')], star: [ns, bd('#AEDBFF')], spark: [bd('#AEDBFF'), bd('#5AA8F8'), bd('#FFFFFF')], gold: [bd('#FFD772'), ns, bd('#FFF2C4')], purple: [bd('#C3A6FF'), ns, bd('#FFFFFF')], blue: [bd('#8EC5FF'), bd('#5AA8F8'), bd('#FFFFFF')], bang: [s(bangSvg())] }[kind];
  }
  const st = s(starSvg('#FFD45E'));
  return { heart: [s(heartSvg('#FF8DB3')), s(heartSvg('#FFB6CE'))], star: [st, s(starSvg('#FFF1B8'))], spark: [s(sparkSvg('#8FB4EE')), s(sparkSvg('#FFD45E')), s(sparkSvg('#FF9EC0'))], gold: [st, s(sparkSvg('#FFC93C')), s(sparkSvg('#FFF6D8'))], purple: [st, s(sparkSvg('#B79BFF')), s(sparkSvg('#FFF6D8'))], blue: [st, s(sparkSvg('#8FB4EE')), s(sparkSvg('#FFF6D8'))], bang: [s(bangSvg())] }[kind];
}
export const plusSprite = (c: string): Sprite => ({ svg: pixPlusSvg(c), px: true });

// ================= 头像框 =================
/**
 * 小八脑袋框（150×150）。cream：白色粗圈 + 深色粗轮廓 + 白色贴纸边；night：月光白的圈 + 外面一圈身份色的柔光 + 金色细线、左边月牙、左下一颗星；
 * porcelain：白釉圈 + 钴蓝细线 + 一圈小蓝点（大航海描金）
 */
export function frameHachi(tier: Tier, sty: 'cream' | 'night' | 'porcelain'): string {
  const night = sty === 'night', porc = sty === 'porcelain', { cx, cy, R } = FR;
  const C = night ? NT[tier] : porc ? { ...PCT[tier], light: PCT[tier].wash } : { ...HT[tier], deep: HT[tier].main };
  const trim = porc ? PCT[tier].trim : undefined, gilt = porc && PCT[tier].gilt;
  const { ears, cap, r1 } = hachiFramePaths(), P = (a: number, r: number) => polar(a, r).map(f).join(',');
  const ink = night ? '#141A48' : gilt ? trim! : porc ? C.main : '#263159';
  const band = night ? '#EEF1FF' : porc ? '#FBFCFF' : '#fff', shade = night ? '#C9D2F4' : porc ? '#E3EAF6' : '#E2EAF6';
  const union = `<circle cx="${cx}" cy="${cy}" r="${r1}"/>${ears.map((d) => `<path d="${d}"/>`).join('')}`;
  const fill = night || porc ? 'url(#cg)' : C.main;
  const base = night ? `<g fill="${C.main}" stroke="${C.main}" stroke-width="12" stroke-linejoin="round" filter="url(#gw)" opacity=".9">${union}</g>`
    : porc ? `<g fill="${band}" stroke="${band}" stroke-width="3" stroke-linejoin="round" filter="url(#s)">${union}</g>`
    : `<g fill="#fff" stroke="#fff" stroke-width="11" stroke-linejoin="round" filter="url(#s)">${union}</g>`;
  const moon = crescentPath(13, 96, 11, 5.5, -4, 9);
  const nightBits = night ? `<path d="${moon}" fill="#FFD27A" filter="url(#gw)" opacity=".85"/><path d="${moon}" fill="url(#mn)" stroke="#FFF5D6" stroke-width="1.1" stroke-linejoin="round"/><polygon points="${starPts(30, 132, 8, 3.8)}" fill="#FFD27A" filter="url(#gw)" opacity=".8"/><polygon points="${starPts(30, 132, 7.4, 3.5)}" fill="url(#mn)" stroke="#FFF5D6" stroke-width="1" stroke-linejoin="round"/>${spark4(10, 64, 3.6, '#FFF2C4')}` : '';
  const porcBits = porc ? `<circle cx="${cx}" cy="${cy}" r="${R + 3}" fill="none" stroke="${trim ?? C.main}" stroke-opacity="${trim ? 1 : 0.6}" stroke-width="${trim ? 1.3 : 0.9}"/>${Array.from({ length: 13 }, (_, i) => { const [x, y] = polar(30 + i * 10, R + 8.5); return `<circle cx="${f(x)}" cy="${f(y)}" r="1.15" fill="${C.light}"/>`; }).join('')}` : '';
  return SV('0 0 150 150', `<defs><filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.6" stdDeviation="2.6" flood-color="#141B45" flood-opacity=".32"/></filter>
    <mask id="h"><rect width="150" height="150" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${R - 0.8}" fill="#000"/></mask>
    <filter id="gw" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4.2"/></filter>
    <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${porc ? C.deep : C.light}"/><stop offset=".55" stop-color="${C.main}"/><stop offset="1" stop-color="${porc ? C.light : C.deep}"/></linearGradient>
    <radialGradient id="mn" cx=".3" cy=".3" r=".9"><stop offset="0" stop-color="#FFF8DC"/><stop offset=".55" stop-color="#FFDC86"/><stop offset="1" stop-color="#F0B04A"/></radialGradient></defs>
  <g mask="url(#h)">${base}
    <g fill="${ink}" stroke="${ink}" stroke-width="${porc ? 3.6 : 5.4}" stroke-linejoin="round">${union}</g>
    <g fill="${fill}">${ears.map((d) => `<path d="${d}"/>`).join('')}</g>
    <circle cx="${cx}" cy="${cy}" r="${(R + r1) / 2}" fill="none" stroke="${band}" stroke-width="${r1 - R}"/>
    <path d="M${P(25, R + 4)} A${R + 4},${R + 4} 0 0 1 ${P(155, R + 4)}" fill="none" stroke="${shade}" stroke-width="5" stroke-linecap="round"/>
    <path d="${cap}" fill="${fill}"/>
    <path d="M${P(-150, R + 8.5)} A${R + 8.5},${R + 8.5} 0 0 1 ${P(-128, R + 8.5)}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".75"/>
    <circle cx="${cx}" cy="${cy}" r="${R + 0.6}" fill="none" stroke="${ink}" stroke-width="${porc ? 2 : 2.8}"/>
    ${night ? `<circle cx="${cx}" cy="${cy}" r="${R + 2.6}" fill="none" stroke="#E9C46E" stroke-width="1.1"/>` : ''}${porcBits}
    ${[162, 18].map((a) => { const [x, y] = polar(a, R + 6.3); return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="5" ry="3.2" fill="#FF9FB9" opacity="${night ? 0.75 : porc ? 0.55 : 0.9}"/>`; }).join('')}</g>${nightBits}`);
}
/** 像素版小八脑袋（50×50 格，一格 3）：把矢量的耳朵、头顶按格子取样，白色圈左上亮右下暗，深色描边，右下错开一格的硬影子 */
export function framePixel(tier: Tier, inPath: InPath): string {
  const T = PT[tier], u = 3, N = 50, { cx, cy, R } = FR, { ears, cap, r1 } = hachiFramePaths();
  const inEar = ears.map(inPath), inCap = inPath(cap);
  const at = (x: number, y: number): [number, number] => [x * u + u / 2, y * u + u / 2];
  const inRing = (x: number, y: number) => { const [px, py] = at(x, y), d = Math.hypot(px - cx, py - cy); return d >= R && d < r1 + 1; };
  const ear = (x: number, y: number) => { const [px, py] = at(x, y); return inEar.some((t) => t(px, py)); };
  const inU = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && (inRing(x, y) || ear(x, y));
  const cells: Array<[number, number, string]> = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!inU(x, y)) continue;
    const [px, py] = at(x, y), edge = !inU(x - 1, y) || !inU(x + 1, y) || !inU(x, y - 1) || !inU(x, y + 1);
    const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy), lit = (-dx - dy) / (d * Math.SQRT2), a = (Math.atan2(dy, dx) * 180) / Math.PI;
    let c: string;
    if (edge) c = PIX_DARK;
    else if (ear(x, y) || inCap(px, py)) c = lit > 0.55 ? T.light : lit < -0.35 ? T.deep : T.main;
    else if (d > R + 3 && d < R + 9 && (Math.abs(a - 162) < 5 || Math.abs(a - 18) < 5)) c = '#FF9FB9';
    else c = lit > 0.3 ? '#FFFFFF' : lit < -0.35 ? '#B9C5E4' : '#E6ECF8';
    cells.push([x, y, c]);
  }
  const has = new Set(cells.map(([x, y]) => `${x},${y}`));
  let sh = '', r = '';
  for (const [x, y] of cells) if (!has.has(`${x + 1},${y + 1}`)) sh += `<rect x="${x * u + u}" y="${y * u + u}" width="${u + 0.04}" height="${u + 0.04}"/>`;
  for (const [x, y, c] of cells) r += `<rect x="${x * u}" y="${y * u}" width="${u + 0.04}" height="${u + 0.04}" fill="${c}"/>`;
  return SV('0 0 150 150', `<g shape-rendering="crispEdges"><g fill="#050A26" opacity=".45">${sh}</g>${r}</g>`);
}
/** 果冻玻璃：玻璃圈 + 小八果冻头顶和耳朵；边缘光按身份换色（大航海外面再加一圈同色柔光） */
export function frameJelly(tier: Tier): string {
  const rim = JT[tier], { cx, cy, R } = FR, { ears, cap, r1 } = hachiFramePaths(), glow = tier !== 'n';
  const union = `<circle cx="${cx}" cy="${cy}" r="${r1}"/>${ears.map((d) => `<path d="${d}"/>`).join('')}`;
  return SV('0 0 150 150', `<defs><filter id="d" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="4"/></filter><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <mask id="h"><rect width="150" height="150" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${R - 0.6}" fill="#000"/></mask>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${JB[0]}"/><stop offset=".5" stop-color="${JB[1]}"/><stop offset="1" stop-color="${JB[2]}"/></linearGradient>
    <linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${rim}"/><stop offset=".4" stop-color="${rim}" stop-opacity=".4"/><stop offset=".75" stop-color="${rim}" stop-opacity=".18"/><stop offset="1" stop-color="${rim}" stop-opacity=".6"/></linearGradient>
    <clipPath id="u">${union}</clipPath></defs>
  <g mask="url(#h)"><g fill="#050816" opacity=".45" transform="translate(0 5)" filter="url(#d)">${union}</g>
    ${glow ? `<g fill="none" stroke="${rim}" stroke-width="7" opacity=".55" filter="url(#d)">${union}</g>` : ''}
    <g fill="#1B2348" opacity=".72">${union}</g>
    <g clip-path="url(#u)"><path d="${cap}" fill="url(#g)" opacity=".9"/>${ears.map((d) => `<path d="${d}" fill="url(#g)"/>`).join('')}<circle cx="${cx}" cy="${cy - 6}" r="${r1 + 2}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="6" filter="url(#b)"/></g>
    <g fill="none" stroke="url(#r)" stroke-width="1.8" stroke-linejoin="round">${union}</g>
    <circle cx="${cx}" cy="${cy}" r="${R + 0.4}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/></g>
  <path d="M${polar(-160, r1 - 3).map(f).join(',')} A${r1 - 3},${r1 - 3} 0 0 1 ${polar(-140, r1 - 3).map(f).join(',')}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2" stroke-linecap="round"/>`);
}
/** 一种外观的小八脑袋框（奶油贴纸的格子花边是素材包里的图，由调用方处理） */
export function themeFrame(look: ThemeLook, tier: Tier, inPath: InPath): string {
  if (look === 'pixel') return framePixel(tier, inPath);
  if (look === 'jelly') return frameJelly(tier);
  return frameHachi(tier, look);
}

// ================= 气泡 =================
/** 气泡图比气泡本身大多少（描边、柔光、耳朵）：[四周, 上面再多留] */
export const BUB_PAD: Record<ThemeLook, [number, number]> = { jelly: [18, 30], porcelain: [16, 30], cream: [16, 30], night: [20, 30], pixel: [0, 0] };
/** 像素气泡上面留给耳朵的格数 */
export const PIX_ET = 7;
let seq = 0;
/** 奶油贴纸：纸色渐变 + 一层颗粒 + 白色贴纸边 + 身份色缝线；lace 时右上是格子花边的两只猫耳，否则是小八的头顶 */
export function creamBubble(w: number, h: number, k: number, tier: Tier, a: number, lace: boolean): string {
  const M = 16 * k, ET = 30 * k, W = w + 2 * M, H = h + ET + 2 * M, x0 = M, y0 = ET + M;
  const R = bubbleR(h, k), rl = 24 * k, T = CREAM[tier], HC = HT[tier], id = `c${++seq}`;
  const ears = earsOf(x0 + w, y0, R, k), HE = lace ? null : hachiHead(x0 + w, y0, R, k);
  const body = bodyPath(x0, y0, w, h, R, rl, HE ? HE.seg : ears.map((e) => earSeg(e)).join(' '));
  const plain = bodyPath(x0, y0, w, h, R, rl, null);
  const d = 8.5 * k, stitch = bodyPath(x0 + d, y0 + d, w - 2 * d, h - 2 * d, R - d, Math.max(5 * k, rl - d), null);
  const earOuter = ears.map((e) => `M${f(e.cx - e.w / 2)},${f(e.y + 6 * k)} ${earSeg(e)} L${f(e.cx + e.w / 2)},${f(e.y + 6 * k)} Z`).join(' ');
  const earIn = ears.map((e) => `M${f(e.cx - e.w * 0.29)},${f(e.y + 1.5 * k)} ${earSeg({ ...e, w: e.w * 0.58, h: e.h * 0.66 }, 1, 1.5 * k).replace(/^L[^C]*/, '')} Z`).join(' ');
  return SV(`0 0 ${f(W)} ${f(H)}`, `<defs>
    <filter id="${id}s" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="${f(4.5 * k)}"/></filter>
    <linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFEFA"/><stop offset=".6" stop-color="#FFF9EE"/><stop offset="1" stop-color="#FFF3E0"/></linearGradient>
    <pattern id="${id}g" width="${f(7 * k)}" height="${f(7 * k)}" patternUnits="userSpaceOnUse"><rect width="${f(7 * k)}" height="${f(7 * k)}" fill="${T.g0}"/><rect width="${f(3.5 * k)}" height="${f(7 * k)}" fill="${T.g1}" opacity=".5"/><rect width="${f(7 * k)}" height="${f(3.5 * k)}" fill="${T.g1}" opacity=".5"/></pattern>
    <filter id="${id}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${f(1.3 / k)}" numOctaves="1" seed="${seq % 9}"/><feColorMatrix values="0 0 0 0 .55  0 0 0 0 .45  0 0 0 0 .3  0 0 0 1.4 -.66"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y0)}" x2="0" y2="${f(y0 + 40 * k)}"><stop offset="0" stop-color="${HC.main}" stop-opacity=".9"/><stop offset=".35" stop-color="${HC.main}" stop-opacity=".55"/><stop offset="1" stop-color="${HC.main}" stop-opacity=".32"/></linearGradient>
    <clipPath id="${id}c"><path d="${plain}"/></clipPath></defs>
  <path d="${body}" fill="#141B45" opacity=".34" transform="translate(0 ${f(4 * k)})" filter="url(#${id}s)"/>
  <path d="${body}" fill="none" stroke="#1C2550" stroke-opacity=".22" stroke-width="${f(12.5 * k)}" stroke-linejoin="round"/>
  <path d="${body}" fill="none" stroke="#fff" stroke-width="${f(10 * k)}" stroke-linejoin="round"/>
  <path d="${body}" fill="url(#${id}p)" fill-opacity="${a}"/>
  ${HE ? '' : `<path d="${earOuter}" fill="#FFFBF2"/>`}
  <path d="${plain}" fill="#000" opacity="${f(0.22 * a)}" filter="url(#${id}n)"/>
  <g clip-path="url(#${id}c)"><path d="${plain}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="${f(5 * k)}" transform="translate(0 ${f(2.2 * k)})"/><path d="${plain}" fill="none" stroke="#C9A066" stroke-opacity=".09" stroke-width="${f(6 * k)}" transform="translate(0 ${f(-2.5 * k)})"/></g>
  <path d="${stitch}" fill="none" stroke="${T.st}" stroke-width="${f(2.2 * k)}" stroke-dasharray="${f(7 * k)} ${f(5.5 * k)}" stroke-linecap="round"/>
  ${HE ? `<path d="${HE.cap}" fill="url(#${id}b)" clip-path="url(#${id}c)"/><path d="${HE.fill}" fill="${HC.main}"/><path d="${HE.line}" fill="none" stroke="#263159" stroke-width="${f(2.6 * k)}" stroke-linejoin="round" stroke-linecap="round"/>` : `<path d="${earIn}" fill="url(#${id}g)" stroke="${T.g1}" stroke-width="${f(1.4 * k)}" stroke-linejoin="round"/>`}`);
}
/** 星月夜空：深蓝渐变（半透明）+ 上沿一层很淡的反光 + 底下几团星云 + 下半截零星小星星（不落在字后面）；描边身份色渐变到白，外面一圈柔光 */
export function nightBubble(w: number, h: number, k: number, tier: Tier, a: number): string {
  const M = 20 * k, ET = 30 * k, W = w + 2 * M, H = h + ET + 2 * M, x0 = M, y0 = ET + M;
  const R = bubbleR(h, k), rl = 24 * k, T = NT[tier], id = `n${++seq}`, HE = hachiHead(x0 + w, y0, R, k);
  const body = bodyPath(x0, y0, w, h, R, rl, HE.seg), plain = bodyPath(x0, y0, w, h, R, rl, null);
  const d = 4.5 * k, inner = bodyPath(x0 + d, y0 + d, w - 2 * d, h - 2 * d, R - d, rl - d, null);
  const rnd = mulberry(Math.round(w * 7 + h));
  let stars = '';
  for (let i = 0; i < 18; i++) stars += `<circle cx="${f(x0 + 60 * k + rnd() * (w - 110 * k))}" cy="${f(y0 + h * 0.55 + rnd() * (h * 0.4))}" r="${f((0.5 + rnd() * 1) * k)}" fill="#fff" opacity="${f(0.3 + rnd() * 0.55)}"/>`;
  const x1 = x0 + w, yb = y0 + h;
  return SV(`0 0 ${f(W)} ${f(H)}`, `<defs>
    <filter id="${id}g" x="-15%" y="-40%" width="130%" height="180%"><feGaussianBlur stdDeviation="${f(6.5 * k)}"/></filter>
    <filter id="${id}c" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="${f(10 * k)}"/></filter>
    <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D296E"/><stop offset=".5" stop-color="#131C55"/><stop offset="1" stop-color="#0B1140"/></linearGradient>
    <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D2DDFF" stop-opacity=".12"/><stop offset=".3" stop-color="#D2DDFF" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${T.main}"/><stop offset=".6" stop-color="${T.light}"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>
    <linearGradient id="${id}e" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y0 - 22 * k)}" x2="0" y2="${f(y0 + 2 * k)}"><stop offset="0" stop-color="${T.light}"/><stop offset="1" stop-color="${T.main}"/></linearGradient>
    <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y0)}" x2="0" y2="${f(y0 + 42 * k)}"><stop offset="0" stop-color="${T.main}" stop-opacity=".85"/><stop offset=".4" stop-color="${T.main}" stop-opacity=".45"/><stop offset="1" stop-color="${T.main}" stop-opacity=".18"/></linearGradient>
    <clipPath id="${id}k"><path d="${plain}"/></clipPath></defs>
  <path d="${body}" fill="none" stroke="${T.main}" stroke-width="${f(11 * k)}" stroke-linejoin="round" filter="url(#${id}g)" opacity=".9"/>
  <path d="${body}" fill="url(#${id}f)" fill-opacity="${a}"/>
  <g clip-path="url(#${id}k)" opacity="${f(Math.min(1, a + 0.15))}">
    <g filter="url(#${id}c)"><ellipse cx="${f(x1 - R * 1.7)}" cy="${f(yb + 4 * k)}" rx="${f(74 * k)}" ry="${f(22 * k)}" fill="#6153DA" opacity=".55"/><ellipse cx="${f(x1 - R * 3.8)}" cy="${f(yb + 9 * k)}" rx="${f(64 * k)}" ry="${f(18 * k)}" fill="#3F6FE8" opacity=".5"/><ellipse cx="${f(x0 + w * 0.4)}" cy="${f(yb + 12 * k)}" rx="${f(96 * k)}" ry="${f(16 * k)}" fill="#7B5CE2" opacity=".35"/></g>
    ${stars}<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="url(#${id}h)"/></g>
  <path d="${HE.cap}" fill="url(#${id}b)" clip-path="url(#${id}k)"/><path d="${HE.fill}" fill="url(#${id}e)"/>
  <path d="${body}" fill="none" stroke="url(#${id}r)" stroke-width="${f(2.6 * k)}" stroke-linejoin="round"/>
  <path d="${inner}" fill="none" stroke="${T.light}" stroke-opacity=".3" stroke-width="${f(1.1 * k)}"/>
  ${spark4(x1 - R * 2.1, y0 + h * 0.76, 4.2 * k, '#FFE7A8')}${spark4(x0 + w * 0.52, y0 + h * 0.86, 2.8 * k, '#C9D8FF')}`);
}
/** 像素气泡的格子数 */
export const pixCells = (w: number, h: number, k: number): [number, number] => [Math.max(8, Math.round(w / (3 * k))), Math.max(8, Math.round(h / (3 * k)))];
/**
 * 像素小屋：3px 一格；最外一圈深色，两圈身份色（上、左亮，下、右暗），再一圈深色，里面是半透明底色；右下错开一格的硬影子。
 * 右上角是像素版的小八头顶：和其他外观同一条轮廓按格子取样，蓝色下沿三格用棋盘格点点过渡。图上面多留 PIX_ET 格放耳朵
 */
export function pixelBubble(w: number, h: number, k: number, tier: Tier, a: number, inPath: InPath): string {
  const u = 3 * k, [cols, rows] = pixCells(w, h, k), T = PT[tier], E = PIX_ET;
  const cut = (dx: number, dy: number, n: number) => dx + dy < n;
  const inB = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && !cut(cols - 1 - c, r, 4) && !cut(cols - 1 - c, rows - 1 - r, 4) && !cut(c, r, 3) && !cut(c, rows - 1 - r, 3);
  const depth = (c: number, r: number) => { let d = 0; for (; d < 4; d++) { const s = d + 1; if (!(inB(c + s, r) && inB(c - s, r) && inB(c, r + s) && inB(c, r - s))) break; } return d; };
  const HE = hachiHead(cols * u, 0, Math.min(rows * u * 0.42, 42 * k), k), inEarP = inPath(HE.fill), inCapP = inPath(HE.cap);
  const isEar = (c: number, r: number) => r < 0 && r >= -E && inEarP((c + 0.5) * u, (r + 0.5) * u);
  const isCap = (c: number, r: number) => inCapP((c + 0.5) * u, (r + 0.5) * u);
  const color = (c: number, r: number): string => {
    const d = depth(c, r);
    if (d === 0) return r === 0 && isEar(c - 1, -1) && isEar(c + 1, -1) ? T.main : PIX_DARK; // 耳根和气泡上沿接上
    const lit = !inB(c, r - d - 1) || !inB(c - d - 1, r);
    if (d === 1) return lit ? T.light : T.main;
    if (d === 2) return lit ? T.main : T.deep;
    if (d === 3) return '#0E1A4C';
    if (isCap(c, r)) return isCap(c, r + 3) ? 'B' : (c + r) % 2 ? 'B' : 'F';
    return 'F';
  };
  const runs = (fn: (c: number, r: number) => string, dx: number, dy: number, style: (col: string) => string) => {
    let s = '';
    for (let r = 0; r < rows; r++) {
      let run: { c: number; n: number; col: string } | null = null;
      const flush = () => { if (run) s += `<rect x="${f((run.c + dx) * u)}" y="${f((r + dy + E) * u)}" width="${f(run.n * u + 0.03)}" height="${f(u + 0.03)}" ${style(run.col)}/>`; run = null; };
      for (let c = 0; c < cols; c++) { const col = inB(c, r) ? fn(c, r) : null; if (run && run.col === col) { run.n++; continue; } flush(); if (col) run = { c, n: 1, col }; }
      flush();
    }
    return s;
  };
  const shadow = runs(() => 'S', 1, 1, () => 'fill="#050A26" fill-opacity=".5"');
  const body = runs(color, 0, 0, (col) => (col === 'F' ? `fill="#16225E" fill-opacity="${a}"` : col === 'B' ? `fill="${T.main}" fill-opacity=".8"` : `fill="${col}"`));
  let ears = '', earSh = '';
  for (let r = -E; r < 0; r++) for (let c = Math.max(0, cols - 60); c < cols; c++) {
    if (!isEar(c, r)) continue;
    const edge = !isEar(c - 1, r) || !isEar(c + 1, r) || !isEar(c, r - 1);
    ears += `<rect x="${f(c * u)}" y="${f((r + E) * u)}" width="${f(u + 0.03)}" height="${f(u + 0.03)}" fill="${edge ? PIX_DARK : T.main}"/>`;
    earSh += `<rect x="${f((c + 1) * u)}" y="${f((r + E + 1) * u)}" width="${f(u + 0.03)}" height="${f(u + 0.03)}"/>`;
  }
  return SV(`0 0 ${f((cols + 1) * u)} ${f((rows + 1 + E) * u)}`, `<g shape-rendering="crispEdges"><g fill="#050A26" opacity=".5">${earSh}</g>${shadow}${body}${ears}</g>`);
}
/** 青花瓷：白釉底（半透明）+ 釉光，钴蓝两道弦纹，小八头顶钴蓝晕染；提督多一道金线，总督金边 */
export function porcelainBubble(w: number, h: number, k: number, tier: Tier, a: number): string {
  const M = 16 * k, ET = 30 * k, W = w + 2 * M, H = h + ET + 2 * M, x0 = M, y0 = ET + M;
  const R = bubbleR(h, k), rl = 24 * k, C = PCT[tier], id = `q${++seq}`, HE = hachiHead(x0 + w, y0, R, k);
  const body = bodyPath(x0, y0, w, h, R, rl, HE.seg), plain = bodyPath(x0, y0, w, h, R, rl, null);
  const ins = (d: number) => bodyPath(x0 + d, y0 + d, w - 2 * d, h - 2 * d, R - d, Math.max(4 * k, rl - d), null);
  return SV(`0 0 ${f(W)} ${f(H)}`, `<defs>
    <filter id="${id}s" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="${f(5 * k)}"/></filter>
    <linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDFEFF"/><stop offset=".55" stop-color="#F4F7FC"/><stop offset="1" stop-color="#E8EEF8"/></linearGradient>
    <radialGradient id="${id}l" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y0)}" x2="0" y2="${f(y0 + 44 * k)}"><stop offset="0" stop-color="${C.main}" stop-opacity=".82"/><stop offset=".4" stop-color="${C.main}" stop-opacity=".38"/><stop offset="1" stop-color="${C.wash}" stop-opacity=".1"/></linearGradient>
    <linearGradient id="${id}e" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y0 - 22 * k)}" x2="0" y2="${f(y0 + 2 * k)}"><stop offset="0" stop-color="${C.deep}"/><stop offset="1" stop-color="${C.main}"/></linearGradient>
    <clipPath id="${id}c"><path d="${plain}"/></clipPath></defs>
  <path d="${body}" fill="#0E1E4A" opacity=".24" transform="translate(0 ${f(4 * k)})" filter="url(#${id}s)"/>
  <path d="${body}" fill="url(#${id}p)" fill-opacity="${a}"/>
  <g clip-path="url(#${id}c)"><ellipse cx="${f(x0 + w * 0.32)}" cy="${f(y0 + h * 0.1)}" rx="${f(w * 0.34)}" ry="${f(h * 0.36)}" fill="url(#${id}l)" opacity=".75"/><path d="${HE.cap}" fill="url(#${id}b)"/><path d="${plain}" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width="${f(3 * k)}" transform="translate(0 ${f(2 * k)})"/></g>
  <path d="${HE.fill}" fill="url(#${id}e)"/>
  <path d="${body}" fill="none" stroke="${C.gilt ? C.trim! : C.main}" stroke-width="${f(2.2 * k)}" stroke-linejoin="round"/>
  <path d="${ins(5 * k)}" fill="none" stroke="${C.main}" stroke-opacity=".55" stroke-width="${f(1 * k)}"/>
  ${C.trim ? `<path d="${ins(7.6 * k)}" fill="none" stroke="${C.trim}" stroke-width="${f(1.2 * k)}"/>` : ''}`);
}
/** 青海波：一层层的半圆浪纹，从右下角往左上淡出去（单独一张图，进场时晚一点晕开） */
export function wavesSvg(w: number, h: number, k: number, tier: Tier): string {
  const M = 16 * k, ET = 30 * k, W = w + 2 * M, H = h + ET + 2 * M, x0 = M, y0 = ET + M, R = bubbleR(h, k), C = PCT[tier], id = `w${++seq}`;
  const plain = bodyPath(x0, y0, w, h, R, 24 * k, null), r = 11 * k, xs = x0 + w * 0.42, ys = y0 + h * 0.38;
  let g = '';
  for (let j = 0, y = ys; y < y0 + h + r; j++, y += r / 2) for (let x = xs + (j % 2 ? r : 0); x < x0 + w + r; x += 2 * r)
    g += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#F7F9FE"/>${[1, 0.7, 0.42].map((t) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * t)}" fill="none" stroke="${C.wash}" stroke-width="${f(0.9 * k)}"/>`).join('')}`;
  return SV(`0 0 ${f(W)} ${f(H)}`, `<defs><clipPath id="${id}c"><path d="${plain}"/></clipPath>
    <radialGradient id="${id}g" gradientUnits="userSpaceOnUse" cx="${f(x0 + w)}" cy="${f(y0 + h)}" r="${f(Math.min(w * 0.55, 260 * k))}"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="${id}m"><rect width="${f(W)}" height="${f(H)}" fill="url(#${id}g)"/></mask></defs>
    <g clip-path="url(#${id}c)" mask="url(#${id}m)" opacity=".8">${g}</g>`);
}
/** 果冻玻璃：深色玻璃（半透明）+ 上沿一点高光、里面上亮下暗、下沿一丝彩色折射；边缘光是身份色 */
export function jellyBubble(w: number, h: number, k: number, tier: Tier, a: number): string {
  const M = 18 * k, ET = 30 * k, W = w + 2 * M, H = h + ET + 2 * M, x0 = M, y0 = ET + M, x1 = x0 + w, y1 = y0 + h;
  const R = bubbleR(h, k), rl = 24 * k, rim = JT[tier], id = `j${++seq}`, HE = hachiHead(x1, y0, R, k);
  const body = bodyPath(x0, y0, w, h, R, rl, HE.seg), plain = bodyPath(x0, y0, w, h, R, rl, null);
  return SV(`0 0 ${f(W)} ${f(H)}`, `<defs>
    <filter id="${id}d" x="-10%" y="-30%" width="120%" height="170%"><feGaussianBlur stdDeviation="${f(8 * k)}"/></filter>
    <filter id="${id}b" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="${f(3 * k)}"/></filter>
    <linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1F284E" stop-opacity="${f(Math.min(1, a * 1.02))}"/><stop offset="1" stop-color="#0B1030" stop-opacity="${f(a)}"/></linearGradient>
    <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${rim}" stop-opacity=".95"/><stop offset=".35" stop-color="${rim}" stop-opacity=".38"/><stop offset=".7" stop-color="${rim}" stop-opacity=".14"/><stop offset="1" stop-color="${rim}" stop-opacity=".55"/></linearGradient>
    <linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="0"><stop offset=".15" stop-color="#7FE7FF" stop-opacity="0"/><stop offset=".55" stop-color="#7FE7FF" stop-opacity=".45"/><stop offset=".85" stop-color="#FF9AD5" stop-opacity=".4"/><stop offset="1" stop-color="#FF9AD5" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}k"><path d="${plain}"/></clipPath></defs>
  <path d="${body}" fill="#050816" opacity=".4" transform="translate(0 ${f(7 * k)})" filter="url(#${id}d)"/>
  <path d="${body}" fill="url(#${id}t)"/>
  <g clip-path="url(#${id}k)"><rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="url(#${id}h)"/>
    <path d="${plain}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="${f(6 * k)}" transform="translate(0 ${f(3 * k)})" filter="url(#${id}b)"/>
    <path d="${plain}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="${f(9 * k)}" transform="translate(0 ${f(-5 * k)})" filter="url(#${id}b)"/>
    <path d="${plain}" fill="none" stroke="url(#${id}c)" stroke-width="${f(2.4 * k)}" transform="translate(0 ${f(-2.6 * k)})"/></g>
  <path d="${body}" fill="none" stroke="url(#${id}r)" stroke-width="${f(1.7 * k)}" stroke-linejoin="round"/>
  <path d="M${f(x0 + rl + 6 * k)},${f(y0 + 4.5 * k)} L${f(x0 + Math.min(w * 0.42, rl + 150 * k))},${f(y0 + 4.5 * k)}" stroke="#fff" stroke-opacity=".7" stroke-width="${f(2.2 * k)}" stroke-linecap="round"/>
  <path d="M${f(x1 - 6 * k)},${f(y0 + R * 0.7)} L${f(x1 - 6 * k)},${f(Math.max(y0 + R * 0.7, y1 - R * 0.9))}" stroke="#fff" stroke-opacity=".22" stroke-width="${f(1.6 * k)}" stroke-linecap="round"/>`);
}
/** 小八果冻头顶（单独一张图，进场时能抖一下）：两只耳朵 + 气泡右上角一条蓝，往下越来越透明。
 * 放在右边时图里自己左右翻（不用 CSS 翻：抖的时候以耳根为中心缩放，CSS 翻转会跟着这个中心偏开） */
export function jellyCapSvg(w: number, h: number, k: number, mirror: boolean): string {
  const M = 18 * k, ET = 30 * k, W = w + 2 * M, H = h + ET + 2 * M, x0 = M, y0 = ET + M;
  const R = bubbleR(h, k), id = `jc${++seq}`, HE = hachiHead(x0 + w, y0, R, k), plain = bodyPath(x0, y0, w, h, R, 24 * k, null);
  return SV(`0 0 ${f(W)} ${f(H)}`, `<defs>
    <linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y0 - 22 * k)}" x2="0" y2="${f(y0 + 6 * k)}"><stop offset="0" stop-color="${JB[0]}"/><stop offset=".55" stop-color="${JB[1]}"/><stop offset="1" stop-color="${JB[2]}"/></linearGradient>
    <linearGradient id="${id}c" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y0)}" x2="0" y2="${f(y0 + 44 * k)}"><stop offset="0" stop-color="${JB[2]}" stop-opacity=".88"/><stop offset=".45" stop-color="${JB[1]}" stop-opacity=".42"/><stop offset="1" stop-color="${JB[0]}" stop-opacity=".06"/></linearGradient>
    <filter id="${id}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${f(1.6 * k)}"/></filter>
    <clipPath id="${id}k"><path d="${plain}"/></clipPath><clipPath id="${id}e"><path d="${HE.fill}"/></clipPath></defs>
  <g${mirror ? ` transform="translate(${f(W)} 0) scale(-1 1)"` : ''}><path d="${HE.cap}" fill="url(#${id}c)" clip-path="url(#${id}k)"/><path d="${HE.fill}" fill="url(#${id}g)" opacity=".94"/>
  <g clip-path="url(#${id}e)"><path d="${HE.line}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${f(4 * k)}" transform="translate(${f(0.8 * k)} ${f(1.6 * k)})" filter="url(#${id}b)"/></g>
  <path d="${HE.line}" fill="none" stroke="#E6F3FF" stroke-opacity=".85" stroke-width="${f(1.3 * k)}" stroke-linejoin="round" stroke-linecap="round"/></g>`);
}
/** 一条的气泡图（像素外观要 inPath） */
export function bubbleSvg(look: ThemeLook, w: number, h: number, k: number, tier: Tier, a: number, lace: boolean, inPath: InPath): string {
  if (look === 'night') return nightBubble(w, h, k, tier, a);
  if (look === 'pixel') return pixelBubble(w, h, k, tier, a, inPath);
  if (look === 'porcelain') return porcelainBubble(w, h, k, tier, a);
  if (look === 'jelly') return jellyBubble(w, h, k, tier, a);
  return creamBubble(w, h, k, tier, a, lace);
}
/** 气泡外形（带耳朵），给后面的背景模糊层当遮罩 */
export function frostMaskSvg(look: ThemeLook, w: number, h: number, k: number, lace: boolean): string {
  const [M, ET] = BUB_PAD[look].map((v) => v * k) as [number, number], x0 = M, y0 = ET + M, R = bubbleR(h, k);
  const ears = lace && look === 'cream' ? earsOf(x0 + w, y0, R, k).map((e) => earSeg(e)).join(' ') : hachiHead(x0 + w, y0, R, k).seg;
  return SV(`0 0 ${f(w + 2 * M)} ${f(h + ET + 2 * M)}`, `<path d="${bodyPath(x0, y0, w, h, R, 24 * k, ears)}"/>`);
}

// ================= 像素小八 =================
/** 缩成 cells 格后：颜色收进 7 色调色板（发灰的白边、抗锯齿都算白，身子才干净），外面描一格深色边 */
const PIX_PAL: Array<[number, number, number]> = [[20, 25, 58], [255, 255, 255], [120, 180, 245], [52, 116, 214], [255, 150, 186], [255, 212, 94], [232, 80, 110]];
export function pixelize(px: Uint8ClampedArray, W: number, H: number): void {
  const on = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (px[o + 3]! < 100) { px[o + 3] = 0; continue; }
    const r = px[o]!, g = px[o + 1]!, b = px[o + 2]!, lum = r * 0.3 + g * 0.59 + b * 0.11, sat = Math.max(r, g, b) - Math.min(r, g, b);
    let best = PIX_PAL[0]!;
    if (lum > 178 && sat < 72) best = PIX_PAL[1]!;
    else if (!(lum < 112 && sat < 110)) {
      let bd = 1e9;
      for (const q of PIX_PAL) { const d = (r - q[0]) ** 2 * 2 + (g - q[1]) ** 2 * 3 + (b - q[2]) ** 2; if (d < bd) { bd = d; best = q; } }
    }
    px[o] = best[0]; px[o + 1] = best[1]; px[o + 2] = best[2]; px[o + 3] = 255; on[i] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (on[i]) continue;
    if ((x > 0 && on[i - 1]) || (x < W - 1 && on[i + 1]) || (y > 0 && on[i - W]) || (y < H - 1 && on[i + W])) { const o = i * 4; px[o] = 20; px[o + 1] = 25; px[o + 2] = 58; px[o + 3] = 255; }
  }
}
