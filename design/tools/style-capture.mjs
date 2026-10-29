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
for (const rt of routes.length ? routes : ['overview', 'settings']) {
  await page.goto(`${B}/#${rt}`);
  await page.waitForTimeout(4000);
  const html = (await page.content()).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, '');
  const file = path.join(out, `snap-${rt.replace('/', '-')}.html`);
  fs.writeFileSync(file, html);
  console.log(rt, Math.round(html.length / 1024) + 'KB');
}
await browser.close();
