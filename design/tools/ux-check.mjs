// 产品体验第一轮的检查：在 GitHub 的电脑上开演示服务，用浏览器把每一条动效、细节走一遍，过渡中途和结束各截一张图，
// 记下页面报错。由 .github/workflows/ux-check.yml 运行（服务器内存不够同时开演示服务和浏览器）：
//   PW_DIR=<装了 playwright-core 的目录> node design/tools/ux-check.mjs <演示服务日志> <输出目录>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.PW_DIR ?? '.', 'package.json'));
const { chromium } = require('playwright-core');
const [log, out] = process.argv.slice(2);
const text = fs.readFileSync(log, 'utf8');
const pw = /后台密码：(\S+)/.exec(text)?.[1];
const fxUrl = /特效页：(\S+)/.exec(text)?.[1];
if (!pw || !fxUrl) throw new Error('演示服务日志里没有密码或特效页地址');
const B = 'http://127.0.0.1:17601';
fs.mkdirSync(out, { recursive: true });
const notes = [];
const note = (...a) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  notes.push(s);
  console.log(s);
};

const browser = await chromium.launch({ channel: 'chrome' });

async function newCtx(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1, colorScheme: 'light', ...opts });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('sf-theme')) localStorage.setItem('sf-theme', 'light');
    } catch {}
  });
  note('登录', (await ctx.request.post(`${B}/api/auth/login`, { data: { password: pw } })).status());
  return ctx;
}
function watchErrors(page, tag) {
  page.on('pageerror', (e) => note(`[${tag}] 页面出错`, e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|hdslb|bilibili/.test(m.text()) && note(`[${tag}] 控制台`, m.text()));
}
let shotN = 0;
async function shot(page, name, clip) {
  const f = path.join(out, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f, ...(clip ? { clip } : {}) });
}
const wait = (page, ms) => page.waitForTimeout(ms);
const toasts = (page) => page.locator('.toasts .toast').count();
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    note('没做成', name, String(e).split('\n')[0]);
  }
}

// 一个短的 WAV（静音），用来测删除音效
function wav() {
  const n = 8000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

const ctx = await newCtx();
const fx = await ctx.newPage();
await fx.goto(fxUrl);
await wait(fx, 2500);
for (const nm of ['叮咚一下', '第二个音效']) note('上传音效', nm, (await ctx.request.post(`${B}/api/sounds`, { multipart: { file: { name: `${nm}.wav`, mimeType: 'audio/wav', buffer: wav() } } })).status());

const page = await ctx.newPage();
watchErrors(page, '后台');

// 3 打开的头一秒：数据接口慢 3 秒
await step('占位条', async () => {
  await page.route((u) => u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/auth/'), (r) => setTimeout(() => r.continue().catch(() => {}), 3000));
  await page.goto(`${B}/#overview`);
  await wait(page, 900);
  await shot(page, 'open-skeleton');
  note('占位时的文字里有「开始使用」', await page.locator('text=开始使用').count(), '「未登录 B站」', await page.locator('text=未登录 B站').count(), '「还没有动态」', await page.locator('text=还没有动态').count());
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await wait(page, 2600);
  await shot(page, 'open-reveal-mid');
  await wait(page, 1500);
  await shot(page, 'overview');
});

// 1 换页：中途、结束；侧栏底色滑动
await step('换页', async () => {
  await page.click('.side a[href="#rules"]');
  await wait(page, 60);
  await shot(page, 'page-switch-60ms');
  await wait(page, 120);
  await shot(page, 'page-switch-180ms');
  note('侧栏替身（滑动中）', await page.locator('.side .mv-ghost').count());
  await wait(page, 500);
  await shot(page, 'rules');
  note('侧栏替身（结束后）', await page.locator('.side .mv-ghost').count());
});

// 7 标签页下划线滑动
await step('标签滑动', async () => {
  await page.click('.rtabs .rtab:nth-child(3)');
  await page.waitForFunction(() => document.querySelector('.rtabs .rtab:nth-child(3)')?.getAttribute('aria-selected') === 'true');
  note('标签：切换后马上的替身', await page.locator('.rtabs .mv-ghost').count());
  await wait(page, 60);
  await shot(page, 'rtabs-slide-mid', { x: 248, y: 0, width: 1192, height: 260 });
  await wait(page, 500);
});

// 6 删除弹幕规则 → 收起；撤销 → 展开
await step('删除撤销（弹幕规则）', async () => {
  const before = await page.locator('.rt .rt-r').count();
  await page.locator('button[aria-label*="更多操作"], .c-act button[aria-haspopup="menu"]').first().click();
  await wait(page, 400);
  await shot(page, 'rowmenu-open');
  const del = page.locator('.rmenu button:has-text("删除")').first();
  if (await del.count()) {
    await del.click();
    await wait(page, 90);
    await shot(page, 'danmu-delete-mid');
    await wait(page, 600);
    note('弹幕规则：删除前', before, '删除后', await page.locator('.rt .rt-r').count());
    await page.locator('.toast-act:has-text("撤销")').first().click();
    await wait(page, 120);
    await shot(page, 'danmu-undo-mid');
    await wait(page, 800);
    note('撤销后', await page.locator('.rt .rt-r').count());
  } else {
    await page.keyboard.press('Escape');
    await wait(page, 60);
    await shot(page, 'rowmenu-closing');
    note('菜单里没有删除');
  }
});

// 2 回来时还在原来的位置
await step('回来位置', async () => {
  await page.click('.side a[href="#logs"]');
  await wait(page, 1500);
  await page.locator('.main > .page').evaluate((el) => (el.scrollTop = 420));
  await page.selectOption('select[aria-label="播放状态"]', 'played');
  await wait(page, 800);
  const before = await page.locator('.main > .page').evaluate((el) => el.scrollTop);
  await page.click('.side a[href="#overview"]');
  await wait(page, 700);
  await page.click('.side a[href="#logs"]');
  await wait(page, 700);
  note('事件记录：离开前滚到', before, '回来后', await page.locator('.main > .page').evaluate((el) => el.scrollTop), '筛选', await page.locator('select[aria-label="播放状态"]').inputValue());
  await shot(page, 'logs-back');
});

// 4 命令面板：打开、关闭中途
await step('命令面板', async () => {
  await page.keyboard.press('Control+k');
  await wait(page, 500);
  await page.keyboard.press('Escape');
  await wait(page, 70);
  await shot(page, 'palette-closing');
  await wait(page, 400);
  note('关掉后还有面板', await page.locator('.scrim').count());
});

// 8 暂停：马上有反应，提示条滑下来，不另外弹提示
await step('暂停', async () => {
  const t0 = await toasts(page);
  await page.click('button.pausebtn');
  await wait(page, 40);
  note('暂停按钮 40ms 后', await page.locator('button.pausebtn').getAttribute('aria-pressed'), await page.locator('button.pausebtn').getAttribute('class'));
  await wait(page, 90);
  await shot(page, 'pause-mid');
  await wait(page, 900);
  await shot(page, 'paused');
  note('暂停后新增提示条', (await toasts(page)) - t0);
  await page.click('.pausebar .btn.primary');
  await wait(page, 120);
  await shot(page, 'resume-mid');
  await wait(page, 800);
});

// 10 开关：开关上方说「已保存」，不弹提示
await step('开关', async () => {
  await page.click('.side a[href="#settings"]');
  await wait(page, 1200);
  const t0 = await toasts(page);
  const sw = page.locator('button.switch[aria-label="主播本人不触发"]');
  await sw.scrollIntoViewIfNeeded();
  await sw.click();
  await wait(page, 450);
  const r = await sw.boundingBox();
  await shot(page, 'switch-saved', { x: Math.max(0, r.x - 300), y: Math.max(0, r.y - 80), width: 420, height: 140 });
  note('开关：新增提示条', (await toasts(page)) - t0, '已保存气泡', await page.locator('.sw-ok').count());
  await sw.click();
  await wait(page, 1800);
});

// 6 黑名单：移出 → 收起，撤销 → 回来
await step('黑名单', async () => {
  await page.fill('input[aria-label="黑名单 UID"]', '10086');
  await page.keyboard.press('Enter');
  await wait(page, 1500);
  await page.fill('input[aria-label="黑名单 UID"]', '10087');
  await page.keyboard.press('Enter');
  await wait(page, 1500);
  const n0 = await page.locator('.bl-item').count();
  await page.locator('.bl-item .mvb').first().click();
  await wait(page, 100);
  const bl = await page.locator('.bl-list').boundingBox();
  await shot(page, 'blacklist-remove-mid', { x: bl.x - 10, y: bl.y - 10, width: bl.width + 20, height: bl.height + 60 });
  await wait(page, 600);
  note('黑名单：移出前', n0, '移出后', await page.locator('.bl-item').count());
  await page.locator('.toast-act:has-text("撤销")').first().click();
  await wait(page, 1500);
  note('撤销后', await page.locator('.bl-item').count());
});

// 11 删除音效：马上没、能撤销、8 秒后才真正删除
await step('删除音效', async () => {
  await page.click('.side a[href="#assets"]');
  await wait(page, 1200);
  await page.click('.seg button:has-text("音效")');
  note('分段：切换后马上的替身', await page.locator('.seg .mv-ghost').count());
  await wait(page, 60);
  await shot(page, 'assets-seg-slide');
  await wait(page, 600);
  const n0 = await page.locator('.agrid .acard').count();
  await page.locator('.agrid .acard .danger').first().click();
  await wait(page, 100);
  await shot(page, 'sound-delete-mid');
  await wait(page, 700);
  const n1 = await page.locator('.agrid .acard').count();
  await page.locator('.toast-act:has-text("撤销")').first().click();
  await wait(page, 1200);
  const n2 = await page.locator('.agrid .acard').count();
  note('音效：删除前', n0, '删除后', n1, '撤销后', n2, '服务器上', (await (await ctx.request.get(`${B}/api/sounds`)).json()).sounds.length);
  await page.locator('.agrid .acard .danger').first().click();
  await wait(page, 9500);
  note('不撤销、9.5 秒后服务器上', (await (await ctx.request.get(`${B}/api/sounds`)).json()).sounds.length, '页面上', await page.locator('.agrid .acard').count());
});

// 9 草稿条：滑上来；保存后原地「已保存」
await step('草稿条', async () => {
  await page.click('.side a[href="#chat"]');
  await wait(page, 1500);
  const seg = page.locator('.seg[aria-label="样式"] button[aria-pressed="false"]').first();
  await seg.scrollIntoViewIfNeeded();
  await seg.click();
  await wait(page, 100);
  await shot(page, 'draft-in-mid');
  await wait(page, 500);
  const t0 = await toasts(page);
  await page.click('.draftbar .btn.primary');
  await wait(page, 500);
  await shot(page, 'draft-saved');
  note('草稿条：已保存样子', await page.locator('.draftbar.ok').count(), '新增提示条', (await toasts(page)) - t0);
  await wait(page, 1800);
  note('1.8 秒后草稿条还在', await page.locator('.draftbar').count());
});

// 14 导出（含素材文件）
await step('导出', async () => {
  await page.click('.side a[href="#settings"]');
  await wait(page, 1200);
  const b = page.locator('button:has-text("导出（含素材文件）")');
  await b.scrollIntoViewIfNeeded();
  const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await b.click();
  await wait(page, 60);
  note('导出按钮', await page.locator('button[aria-busy="true"]:has-text("正在打包")').count());
  const d = await dl;
  note('开始下载', d ? d.suggestedFilename() : '没有');
  await wait(page, 1200);
  note('提示', await page.locator('.toast').allInnerTexts());
});

// 24 更新后的提示
await step('更新提示', async () => {
  await page.evaluate(() => localStorage.setItem('starfall.seenVersion', '1.0.0'));
  await page.goto(`${B}/?t=1#overview`);
  await wait(page, 2500);
  await shot(page, 'whatsnew');
  await page.click('.verbar .btn.primary');
  await wait(page, 1500);
  await shot(page, 'whatsnew-about');
  note('看过后', await page.evaluate(() => localStorage.getItem('starfall.seenVersion')));
});

// 深色
await step('深色', async () => {
  await page.evaluate(() => localStorage.setItem('sf-theme', 'dark'));
  await page.goto(`${B}/?t=2#overview`);
  await wait(page, 2500);
  await page.click('.side a[href="#rules"]');
  await wait(page, 150);
  await shot(page, 'dark-switch-mid');
  await wait(page, 700);
});

// 15 减少动画
await step('减少动画', async () => {
  const c2 = await newCtx({ reducedMotion: 'reduce' });
  const p2 = await c2.newPage();
  watchErrors(p2, '减少动画');
  await p2.goto(`${B}/#overview`);
  await wait(p2, 2500);
  await p2.click('.side a[href="#rules"]');
  await wait(p2, 40);
  note('减少动画：换页 40ms 后侧栏替身', await p2.locator('.mv-ghost').count(), '页面数', await p2.locator('.main > .page').count());
  await shot(p2, 'reduced-switch-40ms');
  await c2.close();
});

fs.writeFileSync(path.join(out, 'notes.txt'), notes.join('\n') + '\n');
await browser.close();
