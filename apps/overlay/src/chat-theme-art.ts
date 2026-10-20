// 弹幕列表主题外观的图形：气泡、头像框、身份装饰、小八表情怎么挑。都是拼 SVG 字符串，不碰 DOM（方便测试）。
// 设计见 design/preview/chat-looks.html；奶油贴纸的头像框、尾巴、爪印、吊坠和小八表情是图片（chat-looks/），其余都在这里画。

export type ThemeLook = 'cream' | 'night' | 'pixel';
/** 身份：n 普通观众，1 总督、2 提督、3 舰长，anchor 主播 */
export type Tier = 'n' | 1 | 2 | 3 | 'anchor';
interface Tint { main: string; light: string; deep: string }

/** 大航海、主播的身份色；普通观众用外观自己的颜色 */
export const TIER: Record<Exclude<Tier, 'n'>, Tint> = {
  3: { main: '#3D86F5', light: '#BFDBFF', deep: '#1D4A9E' },
  2: { main: '#9B6CF0', light: '#E2D2FF', deep: '#4E2A99' },
  1: { main: '#F0A925', light: '#FFE6A6', deep: '#7E4F05' },
  anchor: { main: '#F06E9C', light: '#FFD3E2', deep: '#9C2D57' },
};
export const BASE: Record<ThemeLook, Tint> = {
  cream: { main: '#7FA6E0', light: '#E3ECFA', deep: '#2E4E8E' },
  night: { main: '#6E8CFF', light: '#B8C8FF', deep: '#16205A' },
  pixel: { main: '#4A7BFF', light: '#A9C8FF', deep: '#0B1433' },
};
export const tint = (look: ThemeLook, tier: Tier): Tint => (tier === 'n' ? BASE[look] : TIER[tier]);

const NAVY = '#1C2550';
const PIX_DARK = '#0B1433';
const n2 = (v: number) => v.toFixed(2);
export const SV = (vb: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`;
export const svgUrl = (s: string) => `data:image/svg+xml,${encodeURIComponent(s)}`;
const place = (x: number, y: number, sc: number, body: string) => `<g transform="translate(${n2(x)} ${n2(y)}) scale(${sc.toFixed(4)})">${body}</g>`;

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

// ---------- 小八表情：按弹幕内容挑（从上往下，先对上先用）；都对不上的轮流用开心、眨眼、眯眼 ----------
export const CATS: Array<[id: string, re: RegExp]> = [
  ['laughing', /哈{3,}|h{4,}|笑死|笑疯|233/i],
  ['grin', /哈哈|嘿嘿嘿|笑/],
  ['crying', /呜呜|哭|555|泪奔|委屈|难过|伤心/],
  ['touched', /感动|泪目|破防|好暖|心疼/],
  ['shocked', /卧槽|我靠|震惊|啊[？?]|什么[!！]/],
  ['awkward', /尴尬|汗|囧|社死/],
  ['exhausted', /无语|…|\.{3}|寄了|麻了|好累|累死/],
  ['pouting', /气死|哼|生气|可恶/],
  ['smug', /嘿嘿|懂了|好家伙|稳了/],
  ['shy', /害羞|羞|脸红|嘤|夸我/],
  ['sleepy', /困|睡觉|晚安|好晚|熬夜/],
  ['heart', /喜欢|爱你|比心|❤|♥/],
  ['flower', /花/],
  ['cheer', /加油|冲|干巴爹|fighting/i],
  ['stareyes', /好看|好美|好帅|好可爱|厉害|牛/],
  ['puzzled', /[？?]|为什么|怎么/],
  ['surprise', /哇|[!！]|欸/],
  ['greet', /晚上好|早上好|来了|打卡/],
];
export const CAT_IDLE = ['happy', 'wink', 'content'];
/** idle：对不上时用第几个；fallback 为 true 表示没对上（调用方把 idle 加一） */
export function pickCat(text: string, sticker: boolean, idle: number): { id: string; fallback: boolean } {
  if (sticker) return { id: 'heart', fallback: false };
  for (const [id, re] of CATS) if (re.test(text)) return { id, fallback: false };
  return { id: CAT_IDLE[idle % CAT_IDLE.length]!, fallback: true };
}

// ---------- 身份装饰 ----------
function starSvg(look: ThemeLook, c: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 9 : 20, a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(24 + r * Math.cos(a)).toFixed(1)},${(25 + r * Math.sin(a)).toFixed(1)}`);
  }
  const p = pts.join(' ');
  if (look === 'night') return SV('0 0 48 48', `<defs><filter id="g"><feGaussianBlur stdDeviation="2.2"/></filter></defs><polygon points="${p}" fill="${c}" filter="url(#g)" opacity=".9"/><polygon points="${p}" fill="#FFF4CF" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>`);
  return SV('0 0 48 48', `<polygon points="${p}" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round"/><polygon points="${p}" fill="${c}" stroke="#3B3550" stroke-width="2.6" stroke-linejoin="round"/><path d="M17 19l3-1" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>`);
}
function crownSvg(look: ThemeLook): string {
  const d = 'M8 34 L5 12 L16 21 L25 6 L34 21 L45 12 L42 34 Z';
  const gems = '<circle cx="25" cy="27" r="3.2" fill="#FF6F9E"/><circle cx="15" cy="28" r="2.2" fill="#6FB6FF"/><circle cx="35" cy="28" r="2.2" fill="#6FB6FF"/>';
  if (look === 'night') return SV('0 0 50 40', `<defs><filter id="g"><feGaussianBlur stdDeviation="2.4"/></filter></defs><path d="${d}" fill="#FFC24A" filter="url(#g)"/><path d="${d}" fill="#FFD978" stroke="#FFF1C2" stroke-width="1.6" stroke-linejoin="round"/>${gems}`);
  return SV('0 0 50 40', `<path d="${d}" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/><path d="${d}" fill="#FFCC4D" stroke="#3B3550" stroke-width="2.6" stroke-linejoin="round"/><rect x="8" y="31" width="34" height="4" fill="#F0A925"/>${gems}`);
}
/** 四角闪光（星月夜空：头像旁边闪的小星星、昵称前的小图标） */
export const sparkSvg = (c: string) => SV('0 0 20 20', `<defs><filter id="g"><feGaussianBlur stdDeviation="1.2"/></filter></defs><path d="M10 0 Q11 9 20 10 Q11 11 10 20 Q9 11 0 10 Q9 9 10 0Z" fill="${c}" filter="url(#g)"/><path d="M10 2 Q10.8 9.2 18 10 Q10.8 10.8 10 18 Q9.2 10.8 2 10 Q9.2 9.2 10 2Z" fill="#FFF8E0"/>`);

// ---------- 像素小图：字符画 → 一格一格的方块 ----------
type Pal = Record<string, string>;
function pixRects(rows: string[], pal: Pal): string {
  let r = '';
  rows.forEach((line, y) => {
    let x = 0;
    while (x < line.length) {
      const ch = line[x]!;
      let n = 1;
      while (line[x + n] === ch) n++;
      if (pal[ch]) r += `<rect x="${x}" y="${y}" width="${n + 0.02}" height="1.02" fill="${pal[ch]}"/>`;
      x += n;
    }
  });
  return `<g shape-rendering="crispEdges">${r}</g>`;
}
const pixSvg = (rows: string[], pal: Pal) => SV(`0 0 ${rows[0]!.length} ${rows.length}`, pixRects(rows, pal));
const PIX_STAR = ['....o....', '...oYo...', '...oYo...', 'ooooYoooo', 'oYYYYYYYo', '.oYYYYYo.', '..oYYYo..', '.oYYoYYo.', '.oYo.oYo.', '.oo...oo.'];
const PIX_PAW = ['.oo..ooo..oo.', 'oWWooWWWooWWo', 'oWPWoWPWoWPWo', 'oWWWoWWWoWWWo', '.ooWWWWWWWoo.', '.oWWWPPPWWWo.', 'oWWWPPPPPWWWo', 'oWWPPPPPPPWWo', 'oWWWPPPPPWWWo', '.oWWWWWWWWWo.', '..ooooooooo..'];
const PIX_TAIL = ['.........ooo..', '........oWWWo.', '.......oWWWWWo', '.......oWWWWWo', '.......oBWWWo.', '.......oBBBBo.', '......oLBBBBo.', '......oLBBBBo.', '.....oLBBBBo..', '...ooLBBBBBo..', '.ooBBBBBBBo...', 'oBBBBBBBBo....', 'oBBBBBBoo.....', '.oooooo.......'];
const PIX_CROWN = ['.o....o....o.', 'oYo..oYo..oYo', 'oYYooYRYooYYo', 'oYYYYYYYYYYYo', 'oYYBYYRYYBYYo', 'oYYYYYYYYYYYo', 'oDDDDDDDDDDDo', '.ooooooooooo.'];
const PIX_CHARM = ['....Y....', '.........', '....Y....', '.........', '....Y....', ...PIX_STAR];
const PIX_EAR = ['....o......', '...oLo.....', '..oLLLo....', '..oLPLLo...', '.oLPPPLLo..', '.oLPPPPLLo.', 'oMMMMMMMMMo'];
const PIX_HEART = ['.oo.oo.', 'oPPoWPo', 'oPPPPPo', 'oPPPPPo', '.oPPPo.', '..oPo..', '...o...'];
const pixStar = (y: string) => pixSvg(PIX_STAR, { o: '#1A1430', Y: y });

/** 身份装饰：舰长一颗小星、提督两颗、总督一顶小皇冠；返回 [class, 图片地址] */
export function ornaments(look: ThemeLook, guard: number): Array<[string, string, boolean]> {
  if (!guard) return [];
  const star = (cls: string): [string, string, boolean] => look === 'pixel' ? [cls, svgUrl(pixStar('#FFD66B')), true] : [cls, svgUrl(starSvg(look, look === 'night' ? '#FFC24A' : '#FFD45E')), false];
  if (guard === 3) return [star('s1')];
  if (guard === 2) return [star('s1'), star('s2')];
  return [['crown', svgUrl(look === 'pixel' ? pixSvg(PIX_CROWN, { o: PIX_DARK, Y: '#FFD24A', D: '#E09A1C', R: '#FF6F9E', B: '#6FB6FF' }) : crownSvg(look)), look === 'pixel']];
}
/** 昵称前的小图标（没有船锚、不是主播的人才放） */
export function nameIcon(look: ThemeLook): [string, boolean] {
  if (look === 'pixel') return [svgUrl(pixStar('#FFD66B')), true];
  if (look === 'night') return [svgUrl(sparkSvg('#A9C4FF')), false];
  return [svgUrl(starSvg('cream', '#FFD45E')), false];
}

// ---------- 头像框：画在 150×150 里，头像洞的中心 (75, 80)，半径 44 ----------
const FR = { cx: 75, cy: 80, R: 44 };
/** 框图放到头像上的位置：fw/fh 是框图为头像的几倍大，fcx/fcy 是洞的中心在框图里的位置（比例）；m 是洞为头像的几倍 */
export const frameGeo = (W: number, H: number, cx: number, cy: number, hole: number, m = 1.02) => ({ fw: (W / hole) * m, fh: (H / hole) * m, fcx: cx / W, fcy: cy / H });
export const DRAWN_GEO = frameGeo(150, 150, FR.cx, FR.cy, FR.R * 2);
/** 奶油贴纸用素材里的格纹框（320×306，洞在 159.7, 149.5，直径 200.9）；洞比头像小一点，框压住头像外圈，整个框不会太大 */
export const CREAM_GEO = frameGeo(320, 306, 159.7, 149.5, 200.9, 0.86);

const polar = (a: number, r: number): [number, number] => [FR.cx + Math.cos((a * Math.PI) / 180) * r, FR.cy + Math.sin((a * Math.PI) / 180) * r];
/** 猫耳：底边贴在圈外沿，angle 是耳朵中线的角度（-90 是正上方），往外伸 */
function earPath(angle: number, rBase: number, len: number, half: number, lean: number): string {
  const [bx1, by1] = polar(angle - half, rBase), [bx2, by2] = polar(angle + half, rBase), [tx, ty] = polar(angle + lean, rBase + len);
  const [cx1, cy1] = polar(angle - half * 0.55, rBase + len * 0.78), [cx2, cy2] = polar(angle + half * 0.55 + lean * 0.3, rBase + len * 0.82);
  return `M${n2(bx1)},${n2(by1)} Q${n2(cx1)},${n2(cy1)} ${n2(tx)},${n2(ty)} Q${n2(cx2)},${n2(cy2)} ${n2(bx2)},${n2(by2)} Z`;
}
const sparkle = (x: number, y: number, r: number) => {
  const q = r * 0.2;
  return `<path d="M${x},${y - r} Q${x + q},${y - q} ${x + r},${y} Q${x + q},${y + q} ${x},${y + r} Q${x - q},${y + q} ${x - r},${y} Q${x - q},${y - q} ${x},${y - r}Z" fill="#FFD978" stroke="${NAVY}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${x - r * 0.22}" cy="${y - r * 0.3}" r="${Math.max(0.7, r * 0.12)}" fill="#fff"/>`;
};
/** 月牙：外圆减内圆，算出两圆交点画成一条路径（这样能描边） */
function crescentPath(cx: number, cy: number, r1: number, dx: number, dy: number, r2: number): string {
  const d = Math.hypot(dx, dy), a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const ux = dx / d, uy = dy / d, px = cx + ux * a, py = cy + uy * a;
  const p1 = [px - uy * hh, py + ux * hh] as const, p2 = [px + uy * hh, py - ux * hh] as const;
  return `M${n2(p1[0])},${n2(p1[1])} A${r1},${r1} 0 1 1 ${n2(p2[0])},${n2(p2[1])} A${r2},${r2} 0 0 0 ${n2(p1[0])},${n2(p1[1])} Z`;
}
function frameNight(tier: Tier): string {
  const t = tier === 'n' ? { main: '#6F86F2', light: '#B9C7FF', deep: '#3B4CB8' } : TIER[tier];
  const { cx, cy, R } = FR, rb = R + 5.5;
  const ears = [earPath(-110, rb + 3, 21, 15, -4), earPath(-70, rb + 3, 21, 15, 4)];
  const moon = crescentPath(34, 40, 14, 6.5, -5, 11.5);
  const [h1, h2] = [polar(200, rb + 2), polar(255, rb + 2)];
  return SV('0 0 150 150', `<defs>
    <linearGradient id="bd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.light}"/><stop offset=".55" stop-color="${t.main}"/><stop offset="1" stop-color="${t.deep}"/></linearGradient>
    <linearGradient id="mn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF3C4"/><stop offset=".6" stop-color="#FFD66E"/><stop offset="1" stop-color="#E9A93C"/></linearGradient>
    <filter id="gw" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>
    <ellipse cx="${cx}" cy="${cy}" rx="${R + 22}" ry="${R + 9}" transform="rotate(-18 ${cx} ${cy})" fill="none" stroke="#DCE4FF" stroke-width="1.3" stroke-dasharray=".1 4.2" stroke-linecap="round" opacity=".8"/>
    <circle cx="${cx}" cy="${cy}" r="${rb}" fill="none" stroke="${t.main}" stroke-width="10" filter="url(#gw)" opacity=".55"/>
    <g fill="${NAVY}" stroke="${NAVY}" stroke-width="3.4" stroke-linejoin="round">${ears.map((d) => `<path d="${d}"/>`).join('')}</g>
    <circle cx="${cx}" cy="${cy}" r="${rb}" fill="none" stroke="${NAVY}" stroke-width="11.4"/>
    <g fill="url(#bd)">${ears.map((d) => `<path d="${d}"/>`).join('')}</g>
    <g fill="#E9DDFF" opacity=".9">${[earPath(-110, rb + 5, 13, 8, -3), earPath(-70, rb + 5, 13, 8, 3)].map((d) => `<path d="${d}"/>`).join('')}</g>
    <circle cx="${cx}" cy="${cy}" r="${rb}" fill="none" stroke="url(#bd)" stroke-width="8"/>
    <path d="M${n2(h1[0])},${n2(h1[1])} A${rb + 2},${rb + 2} 0 0 1 ${n2(h2[0])},${n2(h2[1])}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>
    <circle cx="${cx}" cy="${cy}" r="${R + 2.2}" fill="none" stroke="#F2D27A" stroke-width="1.3"/>
    ${[45, 135, 225, 315].map((a) => { const [x, y] = polar(a, R + 2.2); return `<circle cx="${n2(x)}" cy="${n2(y)}" r="1.7" fill="#FFE59A" stroke="${NAVY}" stroke-width=".8"/>`; }).join('')}
    <path d="${moon}" fill="#FFD27A" filter="url(#gw)" opacity=".6"/>
    <path d="${moon}" fill="url(#mn)" stroke="${NAVY}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${crescentPath(32.5, 41.5, 10, 4.6, -3.6, 8.6)}" fill="#fff" opacity=".35"/>
    ${sparkle(118, 33, 7.5)}${sparkle(131, 50, 4.4)}${sparkle(20, 104, 3.6)}`);
}
/** 像素圈：50×50 格（一格 3），外深色描边、主色（左上亮、右下暗）、里一格描边；左上内侧一道象牙白高光 */
function pixelRing(t: Tint, width: number, extras?: (set: (x: number, y: number, c: string) => void) => void): string {
  const u = 3, N = 50, C = FR.cx / u, Cy = FR.cy / u, rIn = FR.R / u;
  const cells = new Map<string, [number, number, string]>();
  const set = (x: number, y: number, c: string) => cells.set(`${x},${y}`, [x, y, c]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - C, dy = y + 0.5 - Cy, d = Math.hypot(dx, dy);
    if (d < rIn || d >= rIn + width) continue;
    const layer = Math.floor(d - rIn), lit = (-dx - dy) / (d * Math.SQRT2);
    set(x, y, layer === 0 || layer === width - 1 ? NAVY : layer === 1 && lit > 0.45 ? '#FFF3D6' : lit > 0.3 ? t.light : lit < -0.35 ? t.deep : t.main);
  }
  extras?.(set);
  let r = '';
  for (const [x, y, c] of cells.values()) r += `<rect x="${x * u}" y="${y * u}" width="${u + 0.04}" height="${u + 0.04}" fill="${c}"/>`;
  return SV('0 0 150 150', `<g shape-rendering="crispEdges">${r}</g>`);
}
const stamp = (set: (x: number, y: number, c: string) => void, map: string[], ox: number, oy: number, pal: Pal) => map.forEach((row, y) => [...row].forEach((ch, x) => pal[ch] && set(ox + x, oy + y, pal[ch])));
const PIXEL_FRAME_BASE: Tint = { main: '#4A7BFF', light: '#9FC0FF', deep: '#2A49B8' };
function framePixel(tier: Tier): string {
  const t = tier === 'n' ? PIXEL_FRAME_BASE : TIER[tier];
  return pixelRing(t, 5, (set) => {
    stamp(set, PIX_EAR, 11, 4, { o: NAVY, L: t.light, M: t.main, P: '#FF9FC0' });
    stamp(set, PIX_EAR.map((r) => [...r].reverse().join('')), 29, 4, { o: NAVY, L: t.main, M: t.main, P: '#FF9FC0' });
    stamp(set, PIX_HEART, 41, 6, { o: NAVY, P: '#FF8FB1', W: '#FFFFFF' });
  });
}
/** 星月夜空、像素小屋自己的头像框（奶油贴纸用素材里的图） */
export function themeFrame(look: Exclude<ThemeLook, 'cream'>, tier: Tier): string {
  return look === 'night' ? frameNight(tier) : framePixel(tier);
}
/** 简单圆框：选了「B 站头像框」时给普通观众和主播用（B 站框加载失败时也换成它），只有一圈，安静一些 */
export function simpleFrame(look: ThemeLook, tier: Tier): string {
  const t = tier === 'anchor' ? TIER.anchor : null, { cx, cy, R } = FR;
  if (look === 'pixel') return pixelRing(t ?? PIXEL_FRAME_BASE, 4);
  if (look === 'night') {
    const c = t ?? { main: '#6F86F2', light: '#B9C7FF', deep: '#3B4CB8' };
    return SV('0 0 150 150', `<defs><linearGradient id="bd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.light}"/><stop offset=".55" stop-color="${c.main}"/><stop offset="1" stop-color="${c.deep}"/></linearGradient></defs>
      <circle cx="${cx}" cy="${cy}" r="${R + 4}" fill="none" stroke="${NAVY}" stroke-width="8.6"/><circle cx="${cx}" cy="${cy}" r="${R + 4}" fill="none" stroke="url(#bd)" stroke-width="5.4"/>
      <circle cx="${cx}" cy="${cy}" r="${R + 1.6}" fill="none" stroke="#F2D27A" stroke-width="1.1"/>`);
  }
  const main = t ? t.main : '#7FA6E0', light = t ? t.light : '#DCE8FA';
  return SV('0 0 150 150', `<circle cx="${cx}" cy="${cy}" r="${R + 6}" fill="none" stroke="#FFFDF6" stroke-width="15"/>
    <circle cx="${cx}" cy="${cy}" r="${R + 6}" fill="none" stroke="${NAVY}" stroke-width="10.4"/><circle cx="${cx}" cy="${cy}" r="${R + 6}" fill="none" stroke="${light}" stroke-width="8"/>
    <circle cx="${cx}" cy="${cy}" r="${R + 6}" fill="none" stroke="${main}" stroke-width="1.6" stroke-dasharray="4 3.2" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${R + 1.2}" fill="none" stroke="#fff" stroke-width="2"/>`);
}

// ---------- 气泡：按这一条的实际大小画 ----------
// 气泡身体占 (0,0)–(w,h)，猫耳从上沿长出来，尾巴从右端伸出去；放在右边时外面整张左右翻过来。k 是字号倍数
const earX = (w: number, k: number, Ro: number): [number, number] => { const c2 = w - Ro - 16 * k; return [c2 - 50 * k, c2]; };
function bubPath(w: number, h: number, k: number, d: number, Ro: number): string {
  const R = Ro - d, rl = Math.max(4, 20 * k - d), x0 = d, y0 = d, x1 = w - d, y1 = h - d;
  const ew = 44 * k - d * 1.7, eh = 27 * k - d * 1.2;
  const [c1, c2] = earX(w, k, Ro);
  const ear = (cx: number, t: number) => `L${cx - ew / 2},${y0} Q${cx - ew * 0.4},${y0 - eh * 0.75} ${cx + t - 3.5 * k},${y0 - eh + 2.5 * k} Q${cx + t},${y0 - eh - 1.5 * k} ${cx + t + 3.5 * k},${y0 - eh + 2.5 * k} Q${cx + ew * 0.4},${y0 - eh * 0.75} ${cx + ew / 2},${y0}`;
  return `M${x0 + rl},${y0} ${ear(c1, -4 * k)} ${ear(c2, 4 * k)} L${x1 - R},${y0} A${R},${R} 0 0 1 ${x1},${y0 + R} L${x1},${y1 - R} A${R},${R} 0 0 1 ${x1 - R},${y1} L${x0 + rl},${y1} A${rl},${rl} 0 0 1 ${x0},${y1 - rl} L${x0},${y0 + rl} A${rl},${rl} 0 0 1 ${x0 + rl},${y0} Z`;
}
function earInner(w: number, k: number, Ro: number): string {
  const [c1, c2] = earX(w, k, Ro), ew = 24 * k, eh = 17 * k;
  const one = (cx: number, t: number) => `M${cx - ew / 2},${2 * k} Q${cx - ew * 0.36},${-eh * 0.7} ${cx + t},${-eh} Q${cx + ew * 0.36},${-eh * 0.7} ${cx + ew / 2},${2 * k} Z`;
  return one(c1, -3 * k) + one(c2, 3 * k);
}
const tailPath = (x: number, y: number, k: number) => `M${x},${y} C${x + 26 * k},${y + 4 * k} ${x + 46 * k},${y - 8 * k} ${x + 48 * k},${y - 36 * k} C${x + 49 * k},${y - 52 * k} ${x + 36 * k},${y - 58 * k} ${x + 30 * k},${y - 47 * k} C${x + 30 * k},${y - 28 * k} ${x + 18 * k},${y - 16 * k} ${x},${y - 16 * k} Z`;
const spark4 = (x: number, y: number, r: number, c: string) => `<path d="M${x},${y - r} Q${x + r * 0.12},${y - r * 0.12} ${x + r},${y} Q${x + r * 0.12},${y + r * 0.12} ${x},${y + r} Q${x - r * 0.12},${y + r * 0.12} ${x - r},${y} Q${x - r * 0.12},${y - r * 0.12} ${x},${y - r}Z" fill="${c}"/>`;

/** 猫爪（48×44，星月夜空：白色 + 身份色微光） */
const PAW = { toes: [[10, 15, 6.2], [19.5, 9, 6.4], [30, 9, 6.4], [39, 15, 6.2]] as const, pad: [24.5, 29, 13, 11] as const };
function pawNight(main: string, uid: string): string {
  const shapes = (e: number) => PAW.toes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + e}"/>`).join('') + `<ellipse cx="${PAW.pad[0]}" cy="${PAW.pad[1]}" rx="${PAW.pad[2] + e}" ry="${PAW.pad[3] + e}"/>`;
  const pads = PAW.toes.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y + 0.6}" rx="${r * 0.5}" ry="${r * 0.58}"/>`).join('') + `<path d="M17,33 Q16.5,24 24.5,24.5 Q32.5,24 32,33 Q24.5,37 17,33Z"/>`;
  return `<defs><filter id="${uid}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <g fill="${main}" filter="url(#${uid})" opacity=".85">${shapes(3)}</g><g fill="#DCE6FF">${shapes(1.6)}</g><g fill="#fff">${shapes(0)}</g><g fill="#FF9DBF">${pads}</g>`;
}
/** 星星吊坠（26×42，星月夜空）：一串小金珠下面挂一颗描边的五角星 */
function starCharm(): string {
  const beads = [2, 6, 10, 14].map((y) => `<circle cx="13" cy="${y}" r="1.1" fill="#FFE7A8"/>`).join('');
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 4.6 : 10, a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(13 + r * Math.cos(a)).toFixed(1)},${(29 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `${beads}<polygon points="${pts.join(' ')}" fill="#FFD978" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10.5" cy="26" r="1.3" fill="#fff"/>`;
}

export interface BubbleArt {
  /** 奶油贴纸用的图片地址（尾巴、爪印、吊坠） */
  img: (name: 'tail' | 'paw' | CreamCharm) => string;
  /** 小八坐在气泡右端时，气泡上不放猫爪 */
  catAtEnd: boolean;
  /** 这一条的吊坠（奶油贴纸轮流换） */
  charm: CreamCharm;
  /** 每条一个前缀，SVG 里的 id 不重复 */
  uid: string;
}
export type CreamCharm = 'heart-charm' | 'moon-charm' | 'gingham-bow';
export const CREAM_CHARMS: CreamCharm[] = ['heart-charm', 'moon-charm', 'gingham-bow'];
/** 奶油贴纸图片的宽高比（高 / 宽） */
const CREAM_RATIO: Record<'tail' | 'paw' | CreamCharm, number> = { tail: 141 / 160, paw: 129 / 160, 'heart-charm': 160 / 89, 'moon-charm': 161 / 76, 'gingham-bow': 121 / 160 };

/** 气泡里面的 SVG（不含外面的 <svg>）。底色的浓淡用 CSS 变量 --bga，改浓淡不用重画 */
export function bubbleSvg(look: ThemeLook, tier: Tier, w: number, h: number, k: number, a: BubbleArt): string {
  const id = a.uid, t = tint(look, tier), { main, light } = t;
  const Ro = Math.min(h * 0.46, 54 * k), outer = bubPath(w, h, k, 0, Ro);
  if (look === 'cream') {
    const im = (name: 'tail' | 'paw' | CreamCharm, x: number, y: number, wd: number) => `<image href="${a.img(name)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wd.toFixed(1)}" height="${(wd * CREAM_RATIO[name]).toFixed(1)}"/>`;
    const cx = w - Ro * 0.72 - 13 * k;
    const charm = a.charm === 'gingham-bow' ? im(a.charm, cx - 12 * k, -16 * k, 44 * k) : im(a.charm, cx, -10 * k, (a.charm === 'moon-charm' ? 23 : 26) * k);
    return `<defs>
      <filter id="${id}s" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="${4 * k}" stdDeviation="${5 * k}" flood-color="#14203C" flood-opacity=".3"/></filter>
      <filter id="${id}p" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .55  0 0 0 0 .47  0 0 0 0 .36  0 0 0 -1.6 .62"/><feComposite in2="SourceGraphic" operator="in"/></filter>
      <pattern id="${id}g" width="${9 * k}" height="${9 * k}" patternUnits="userSpaceOnUse"><rect width="${9 * k}" height="${9 * k}" fill="${light}"/><rect width="${4.5 * k}" height="${9 * k}" fill="${main}" opacity=".5"/><rect width="${9 * k}" height="${4.5 * k}" fill="${main}" opacity=".5"/></pattern>
      <clipPath id="${id}c"><path d="${outer}"/></clipPath></defs>
      ${im('tail', w - 26 * k, h - 64 * k, 56 * k)}
      <g filter="url(#${id}s)"><path d="${outer}" fill="none" stroke="#fff" stroke-width="${9 * k}" stroke-linejoin="round"/></g>
      <path d="${outer}" style="fill:#FFFAF0;fill-opacity:var(--bga)"/>
      <rect x="0" y="${-30 * k}" width="${w}" height="${h + 30 * k}" fill="#fff" filter="url(#${id}p)" clip-path="url(#${id}c)" style="opacity:calc(var(--bga) * .35)"/>
      <path d="${earInner(w, k, Ro)}" fill="url(#${id}g)" stroke="${main}" stroke-width="${1.2 * k}"/>
      <path d="${bubPath(w, h, k, 7 * k, Ro)}" fill="none" stroke="${main}" stroke-width="${2.4 * k}" stroke-dasharray="${8 * k} ${6 * k}" stroke-linecap="round" opacity=".9"/>
      <path d="${outer}" fill="none" stroke="${main}" stroke-opacity=".35" stroke-width="${1.2 * k}" stroke-linejoin="round"/>
      ${charm}
      ${a.catAtEnd ? '' : im('paw', w - Ro * 0.95 - 26 * k, h - 28 * k, 44 * k)}`;
  }
  if (look === 'night') {
    const tx = w - 14 * k, ty = h - 20 * k;
    let stars = '';
    const rnd = mulberry(Math.round(w * 7 + h));
    for (let i = 0; i < 14; i++) stars += `<circle cx="${(Ro + rnd() * (w - Ro * 1.5)).toFixed(1)}" cy="${(6 * k + rnd() * (h - 12 * k)).toFixed(1)}" r="${((0.5 + rnd() * 0.9) * k).toFixed(2)}" fill="#fff" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
    return `<defs>
      <filter id="${id}b" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="${4.5 * k}"/></filter>
      <filter id="${id}c2" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${7 * k}"/></filter>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A3F96"/><stop offset=".55" stop-color="#16225E"/><stop offset="1" stop-color="#0D1440"/></linearGradient>
      <linearGradient id="${id}t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${main}"/><stop offset=".75" stop-color="${light}"/><stop offset="1" stop-color="#fff"/></linearGradient>
      <clipPath id="${id}k"><path d="${outer}"/></clipPath></defs>
      <path d="${tailPath(tx, ty, k)}" fill="${main}" filter="url(#${id}b)" opacity=".9"/>
      <path d="${tailPath(tx, ty, k)}" fill="url(#${id}t)" stroke="#0B1238" stroke-width="${2.2 * k}" stroke-linejoin="round"/>
      <path d="${outer}" fill="none" stroke="${main}" stroke-width="${6 * k}" filter="url(#${id}b)" opacity=".85"/>
      <path d="${outer}" fill="url(#${id}f)" style="fill-opacity:var(--bga)"/>
      <g clip-path="url(#${id}k)" style="opacity:calc(var(--bga) * .9)"><g filter="url(#${id}c2)" fill="#4B63C8" opacity=".55"><ellipse cx="${w - Ro * 1.6}" cy="${h + 4 * k}" rx="${70 * k}" ry="${22 * k}"/><ellipse cx="${w - Ro * 3.2}" cy="${h + 8 * k}" rx="${60 * k}" ry="${18 * k}"/><ellipse cx="${w * 0.42}" cy="${h + 10 * k}" rx="${90 * k}" ry="${16 * k}"/></g>${stars}</g>
      <path d="${earInner(w, k, Ro)}" fill="${main}" opacity=".55"/>
      <path d="${outer}" fill="none" stroke="${light}" stroke-width="${2 * k}" stroke-linejoin="round"/>
      <path d="${bubPath(w, h, k, 3.5 * k, Ro)}" fill="none" stroke="${main}" stroke-opacity=".45" stroke-width="${1 * k}"/>
      ${spark4(w - Ro * 1.25, h * 0.32, 5 * k, '#FFE7A8')}${spark4(w - Ro * 2.1, h * 0.72, 3.6 * k, '#C9D8FF')}${spark4(w - Ro * 0.75, h * 0.62, 4 * k, '#FFE7A8')}
      ${place(w - 43 * k, 1 * k, 0.95 * k, starCharm())}
      ${a.catAtEnd ? '' : place(w - Ro * 0.9 - 22 * k, h - 28 * k, 0.85 * k, pawNight(main, `${id}w`))}`;
  }
  // 像素：3px 一格，按格子画；最外一圈深色、一圈主色、一圈浅色，里面是底色
  const u = 3 * k, cols = Math.round(w / u), rows = Math.round(h / u), ER = 8;
  const RR = Math.min(7, Math.floor(rows / 2) - 1);
  const e2 = cols - RR - 8, e1 = e2 - 19;
  const corner = (c: number, r: number, cx: number, cy: number, rad: number) => (c - cx) ** 2 + (r - cy) ** 2 <= (rad + 0.35) ** 2;
  const inBody = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    if (c > cols - 1 - RR && r < RR) return corner(c, r, cols - 1 - RR, RR, RR);
    if (c > cols - 1 - RR && r > rows - 1 - RR) return corner(c, r, cols - 1 - RR, rows - 1 - RR, RR);
    if (c < 2 && (r < 2 - c || r > rows - 3 + c)) return false;
    return true;
  };
  const earHalf = (r: number) => Math.floor((ER + r) * 0.85) + 1;
  const inEar = (c: number, r: number) => r < 0 && r >= -ER && [e1, e2].some((ec) => Math.abs(c - ec) <= earHalf(r));
  const inEarPink = (c: number, r: number) => r < -1 && r > -ER + 3 && [e1, e2].some((ec) => Math.abs(c - ec) <= earHalf(r) - 3);
  const inside = (c: number, r: number) => inBody(c, r) || inEar(c, r);
  const color = (c: number, r: number): string => {
    let d = 0;
    for (; d < 3; d++) { const s = d + 1; if (![[s, 0], [-s, 0], [0, s], [0, -s]].every(([dx, dy]) => inside(c + dx!, r + dy!))) break; }
    if (d === 0) return PIX_DARK;
    if (inEar(c, r)) return inEarPink(c, r) ? '#FF9FC0' : d === 1 ? light : main;
    if (d === 1) return main;
    if (d === 2) return r < 4 ? light : tier === 'n' ? '#3A64D8' : main;
    return 'F';
  };
  let rects = '';
  for (let r = -ER; r < rows; r++) {
    let run: { c: number; n: number; col: string } | null = null;
    const flush = () => {
      if (run) rects += `<rect x="${(run.c * u).toFixed(2)}" y="${(r * u).toFixed(2)}" width="${(run.n * u + 0.02).toFixed(2)}" height="${(u + 0.02).toFixed(2)}" ${run.col === 'F' ? 'style="fill:#162252;fill-opacity:var(--bga)"' : `fill="${run.col}"`}/>`;
      run = null;
    };
    for (let c = 0; c < cols; c++) {
      const col = inside(c, r) ? color(c, r) : null;
      if (run && run.col === col) { run.n++; continue; }
      flush();
      if (col) run = { c, n: 1, col };
    }
    flush();
  }
  // 尾巴先画，气泡盖住它的根部；星星吊坠挂在右上
  return `${place(w - 7 * u * 1.2, h - 12 * u * 1.2, u * 1.2, pixRects(PIX_TAIL, { o: PIX_DARK, W: '#FFFFFF', B: main, L: light }))}
    <g shape-rendering="crispEdges">${rects}</g>
    ${place(w - 30 * k - 4.5 * u * 0.8, 0, u * 0.8, pixRects(PIX_CHARM, { o: PIX_DARK, Y: '#FFD24A' }))}
    ${a.catAtEnd ? '' : place(w - Ro * 0.9 - 24 * k, h - 26 * k, u * 1.15, pixRects(PIX_PAW, { o: PIX_DARK, W: '#FFFFFF', P: '#FF8FB1' }))}`;
}

/** 像素小八：缩成 cells 格，颜色收进 8 色调色板，外面描一格深色边（返回 ImageData 处理函数，调用方给画布） */
const PIX_PAL: Array<[number, number, number]> = [[20, 25, 58], [255, 255, 255], [214, 226, 244], [96, 172, 242], [44, 112, 206], [255, 150, 186], [255, 212, 94], [232, 80, 110]];
export function pixelize(px: Uint8ClampedArray, W: number, H: number): void {
  const on = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (px[o + 3]! < 100) { px[o + 3] = 0; continue; }
    const r = px[o]!, g = px[o + 1]!, b = px[o + 2]!, lum = r * 0.3 + g * 0.59 + b * 0.11, sat = Math.max(r, g, b) - Math.min(r, g, b);
    let best = PIX_PAL[0]!;
    if (!(lum < 112 && sat < 110)) {
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
