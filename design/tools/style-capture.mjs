// 界面风格对比用：把演示服务里的后台页面存成静态快照（去掉脚本，只留页面结构和样式文件），
// 之后给快照套上不同风格的样式再截图，不用再开演示服务。由 .github/workflows/style-shots.yml 在 GitHub 的电脑上运行：
//   PW_DIR=<装了 playwright-core 的目录> node design/tools/style-capture.mjs <演示服务日志> <输出目录> [页面...]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.PW_DIR ?? '.', 'package.json'));
const { chromium } = require('playwright-core');
const [log, out, ...routes] = process.argv.slice(2);
const text = fs.readFileSync(log, 'utf8');
const pw = /后台密码：(\S+)/.exec(text)?.[1];
const fxUrl = /特效页：(\S+)/.exec(text)?.[1];
if (!pw || !fxUrl) throw new Error('演示服务日志里没有密码或特效页地址');
const B = 'http://127.0.0.1:17601';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1, colorScheme: 'light' });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('sf-theme', 'light');
  } catch {}
});
console.log('登录', (await ctx.request.post(`${B}/api/auth/login`, { data: { password: pw } })).status());
// 先打开特效页，后台才显示「特效页已连接」
const fx = await ctx.newPage();
await fx.goto(fxUrl);
await fx.waitForTimeout(3000);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('页面出错', e.message));
// 「页面@状态」：先打开页面，再按 STATES 里的步骤点开弹窗、菜单等，拍下那一刻（体验演示要用到弹窗、菜单本来的样子）
const STATES = JSON.parse(process.env.SNAP_STATES ?? '{}');
for (const spec of routes.length ? routes : ['overview', 'settings']) {
  const [rt, st] = spec.split('@');
  if (st?.startsWith('loading')) {
    // 「正在读取」那一刻：接口故意慢 6 秒，整页重新打开，1.2 秒时拍
    await page.route((u) => u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/auth/'), (r) => setTimeout(() => r.continue().catch(() => {}), 6000));
    await page.goto(`${B}/?t=${Date.now()}#${rt}`);
    await page.waitForTimeout(1200);
  } else if (st) {
    // 每个状态都整页重新打开，前一个状态（弹窗、菜单）不会留下来
    await page.goto(`${B}/?t=${Date.now()}#${rt}`);
    await page.waitForTimeout(3500);
  } else {
    await page.goto(`${B}/#${rt}`);
    await page.waitForTimeout(4000);
  }
  for (const step of st ? (STATES[st] ?? []) : []) {
    try {
      if (step.key) await page.keyboard.press(step.key);
      else if (step.click) await page.locator(step.click).first().click({ timeout: 4000 });
      else if (step.js) await page.evaluate(step.js);
      await page.waitForTimeout(step.wait ?? 700);
    } catch (e) {
      console.log('步骤没做成', spec, JSON.stringify(step), String(e).split('\n')[0]);
    }
  }
  const html = (await page.content()).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, '');
  if (st?.startsWith('loading')) await page.unrouteAll({ behavior: 'ignoreErrors' });
  const file = path.join(out, `snap-${spec.replace(/[/@]/g, '-')}.html`);
  fs.writeFileSync(file, html);
  console.log(spec, Math.round(html.length / 1024) + 'KB');
}
await browser.close();
