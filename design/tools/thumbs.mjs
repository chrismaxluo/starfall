// 生成内置特效的效果截图：apps/admin/public/thumbs/<样式>.jpg（9:14，素材库卡片）和 <样式>-w.jpg（16:10，贴着特效裁，选特效的下拉框）
// 用特效页的演示模式（?demo=样式，不连服务端）播放一次，在好看的那一刻截图，按 9:14 裁到特效所在的区域。
// 需要一个能打开特效页的星临服务（例如演示服务）和 Playwright：
//   STARFALL_DATA=<空目录> STARFALL_PORT=17601 node apps/server/src/cli/demo.ts
//   PLAYWRIGHT=<playwright 包所在目录> node design/tools/thumbs.mjs http://127.0.0.1:17601 [只生成这几个样式，逗号分隔]
import { createRequire } from 'node:module';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:17601';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const OUT = path.resolve(import.meta.dirname, '../../apps/admin/public/thumbs');

/** 每个样式在第几毫秒截图（动画走到最完整的时候） */
const AT = { 'royal-gov': 3600, 'royal-adm': 3000, 'royal-cap': 2200, frost: 1500, line: 1100, 'glass-gift': 2400, 'glass-big': 2400, 'glass-mod': 1600, 'glass-dm': 1400 };
const W = 1080;
const H = 1920;
// 和后台卡片一样的深色底，加两团柔光：玻璃特效要有东西在后面才看得出毛玻璃
const BG = `html,body{background:radial-gradient(60% 35% at 72% 18%,rgba(111,110,255,.45),transparent 70%),radial-gradient(55% 30% at 20% 82%,rgba(236,120,170,.28),transparent 70%),linear-gradient(170deg,#1A1B2E,#0C0D16)!important}`;

/** 铺满画面的样式截整个画面，其余的裁到特效附近 */
const FULL = new Set(['royal-gov', 'royal-adm', 'royal-cap']);
/** 慢放倍数：服务器上画得慢、会掉帧，慢放后到点定格，截到的才是想要的那一刻 */
const SLOW = 4;

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript((k) => {
  const st = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => st(fn, (ms ?? 0) * k, ...a);
  const tick = () => {
    for (const a of document.getAnimations()) if (a.playbackRate !== 1 / k) a.playbackRate = 1 / k;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, SLOW);
const only = process.argv[3]?.split(',');
for (const [style, at] of Object.entries(AT).filter(([s]) => !only || only.includes(s))) {
  await page.goto(`${base}/overlay/?demo=${style}`);
  await page.addStyleTag({ content: BG });
  // 从特效真正出现在舞台上开始计时（第一次打开要先加载字体）
  await page.waitForFunction(() => (document.getElementById('stage')?.querySelectorAll('*').length ?? 0) > 3, null, { timeout: 30_000 });
  const t0 = Date.now();
  await page.waitForTimeout(at * SLOW);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  // 特效所在的区域：舞台里所有看得见的元素合起来的范围
  const box = await page.evaluate(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of document.querySelectorAll('#stage *')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      if (r.width >= innerWidth * 0.9 || r.height >= innerHeight * 0.9) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  });
  const b = !FULL.has(style) && box ? box : { x0: 0, y0: 0, x1: W, y1: H };
  const cx = (Math.max(0, b.x0) + Math.min(W, b.x1)) / 2;
  const cy = (Math.max(0, b.y0) + Math.min(H, b.y1)) / 2;
  let w = Math.min(W, Math.max(520, (Math.min(W, b.x1) - Math.max(0, b.x0)) * 1.12));
  let h = (w * 14) / 9;
  if (h > H) { h = H; w = (h * 9) / 14; }
  const x = Math.round(Math.min(W - w, Math.max(0, cx - w / 2)));
  const y = Math.round(Math.min(H - h, Math.max(0, cy - h / 2)));
  await page.screenshot({ path: path.join(OUT, `${style}.jpg`), type: 'jpeg', quality: 82, clip: { x, y, width: Math.round(w), height: Math.round(h) } });
  // 下拉框用的小图：16:10，贴着特效裁（铺满画面的样式取中间偏上的主体）
  const t = box ?? { x0: 0, y0: H * 0.25, x1: W, y1: H * 0.65 };
  const tx0 = Math.max(0, t.x0), tx1 = Math.min(W, t.x1), ty0 = Math.max(0, t.y0), ty1 = Math.min(H, t.y1);
  let ww = Math.max(320, (tx1 - tx0) * 1.1, ((ty1 - ty0) * 1.1 * 16) / 10);
  ww = Math.min(W, ww);
  const wh = (ww * 10) / 16;
  const wx = Math.round(Math.min(W - ww, Math.max(0, (tx0 + tx1) / 2 - ww / 2)));
  const wy = Math.round(Math.min(H - wh, Math.max(0, (ty0 + ty1) / 2 - wh / 2)));
  await page.screenshot({ path: path.join(OUT, `${style}-w.jpg`), type: 'jpeg', quality: 82, clip: { x: wx, y: wy, width: Math.round(ww), height: Math.round(wh) } });
  console.log(style, `${Date.now() - t0}ms`, { x, y, w: Math.round(w), h: Math.round(h) }, { wx, wy, ww: Math.round(ww) });
}
await browser.close();
