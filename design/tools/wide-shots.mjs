// 临时：各页面在 1366 / 1920 / 2560 三种宽度下截图，检查大屏铺满后的效果（GitHub Actions 里跑，合并前删掉）
// 用法：node design/tools/wide-shots.mjs <演示服务地址> <后台密码> <输出目录> <playwright 所在目录>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [B, PW, OUT, PWDIR] = process.argv.slice(2);
const { chromium } = createRequire(path.join(PWDIR, 'package.json'))('playwright');
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = ['overview', 'logs', 'rules', 'rules/danmu', 'assets', 'quickplay', 'chat', 'giftlist', 'music', 'music/rules', 'music/look', 'music/library', 'music/history', 'obs', 'about', 'settings'];
const SIZES = [[1366, 768], [1920, 1080], [2560, 1440]];
// 改之前的样子（只拍 1920，用来对比）
const OLD = '.page{padding:28px 28px 40px!important}.page>*{max-width:1400px!important}.page>.seg{display:inline-flex!important;margin-left:0!important}';

const browser = await chromium.launch();
// 只登录一次（每张图都登录会被登录次数限制挡住），之后复用登录状态
const login = await browser.newContext();
const r = await login.request.post(`${B}/api/auth/login`, { data: { password: PW } });
if (!r.ok()) throw new Error(`登录失败 ${r.status()}`);
const storageState = await login.storageState();
await login.close();
async function shoot(w, h, route, file, css) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', colorScheme: 'light', storageState });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', route, e.message));
  await page.goto(`${B}/#${route}`);
  await page.waitForTimeout(2500);
  if (await page.locator('input[type=password]').count()) console.log('LOGIN-PAGE', file);
  if (css) await page.addStyleTag({ content: css });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 82 });
  await ctx.close();
}
for (const route of ROUTES) {
  const slug = route.replace('/', '-');
  for (const [w, h] of SIZES) await shoot(w, h, route, `${w}-${slug}.jpg`);
  await shoot(1920, 1080, route, `before-1920-${slug}.jpg`, OLD);
  console.log('ok', route);
}
await browser.close();
