// 电脑版产品体验第二轮的检查：在 GitHub 的 Windows 电脑上打开打包好的星临（win-unpacked），走一遍并截图。
// 窗口内容用 Playwright 截，标题栏、右键菜单这类系统画的东西用 PowerShell 截整个屏幕。由 .github/workflows/ux-desktop.yml 运行：
//   PW_DIR=<装了 playwright-core 的目录> node design/tools/desk-check.mjs <Starfall.exe> <输出目录>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.PW_DIR ?? '.', 'package.json'));
const { _electron } = require('playwright-core');
const [exe, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const notes = [];
const note = (...a) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  notes.push(s);
  console.log(s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
/** 截整个屏幕（标题栏、系统菜单也在里面） */
function screen(name) {
  const f = path.resolve(out, `${String(++n).padStart(2, '0')}-${name}.png`);
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${f}')`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'pipe' });
  } catch (e) {
    note('截屏失败', name, String(e).split('\n')[0]);
  }
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    note('没做成', name, String(e).split('\n')[0]);
  }
}
const winInfo = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  return w ? { bounds: w.getBounds(), max: w.isMaximized(), visible: w.isVisible(), url: w.webContents.getURL().slice(0, 40), zoom: w.webContents.getZoomLevel() } : null;
});

/** 刚打开的两秒连着截几张（启动画面一闪而过，等窗口出来再截就晚了） */
function burst(name) {
  const files = Array.from({ length: 8 }, (_, i) => path.resolve(out, `${name}-${i}.png`).replace(/'/g, "''"));
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; foreach ($f in @('${files.join("','")}')) { $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save($f); Start-Sleep -Milliseconds 120 }`;
  return import('node:child_process').then(({ spawn }) => spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }));
}

async function launch(shots) {
  if (shots) await burst(shots);
  const app = await _electron.launch({ executablePath: exe, timeout: 60_000 });
  app.process().stdout?.on('data', () => undefined);
  return app;
}

// ---------- 第一次打开 ----------
let app = await launch('open');
await step('启动画面', async () => {
  const page = await app.firstWindow();
  await sleep(300);
  note('第一张窗口', await winInfo(app));
  screen('splash');
  await page.waitForURL(/^http:\/\/127\.0\.0\.1/, { timeout: 60_000 });
  note('换成后台', await winInfo(app));
  await sleep(4000);
  screen('admin-light');
});

let page = await app.firstWindow();
page.on('pageerror', (e) => note('页面出错', e.message));
// 新装的会自动打开新手引导：先关掉（按 Esc = 稍后再说）
await step('关掉新手引导', async () => {
  await page.waitForSelector('.wiz', { timeout: 8000 });
  await page.keyboard.press('Escape');
  await sleep(800);
  note('新手引导还在', await page.locator('.wiz:not(.mv-out)').count());
});

await step('标题栏跟着暗色', async () => {
  await page.click('button[aria-label="切换亮色 / 暗色"]');
  await sleep(1500);
  screen('admin-dark');
  note('窗口底色设置', await app.evaluate(({ nativeTheme }) => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors })));
});

await step('右键菜单', async () => {
  await page.click('.side a[href="#settings"]');
  await sleep(1200);
  const inp = page.locator('input').first();
  await inp.fill('右键试一下');
  await inp.selectText();
  await inp.click({ button: 'right' });
  await sleep(800);
  screen('context-menu');
  await page.keyboard.press('Escape');
});

await step('缩放', async () => {
  await page.click('.side a[href="#overview"]');
  await sleep(800);
  await page.keyboard.press('Control+Equal');
  await page.keyboard.press('Control+Equal');
  await sleep(600);
  note('按两下 Ctrl 加号后', (await winInfo(app))?.zoom);
  screen('zoom-in');
  await page.keyboard.press('Control+Minus');
  await sleep(300);
  note('再按 Ctrl 减号', (await winInfo(app))?.zoom);
});

await step('服务重启不刷新', async () => {
  await page.evaluate(() => ((window).__mark = 'still-here'));
  const pid = await app.evaluate(({ app: a }) => a.getAppMetrics().find((m) => m.type === 'Utility' && /星临服务|Starfall/.test(m.name ?? m.serviceName ?? ''))?.pid ?? a.getAppMetrics().filter((m) => m.type === 'Utility').map((m) => m.pid).at(-1));
  note('服务进程', pid);
  process.kill(pid);
  await sleep(300);
  screen('server-restarting');
  await sleep(8000);
  note('重启后页面没刷新', await page.evaluate(() => (window).__mark ?? '刷新过了'));
  screen('server-back');
});

await step('页面崩溃自动恢复', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await sleep(6000);
  page = app.windows()[0] ?? page;
  note('恢复后', await winInfo(app));
  screen('page-recovered');
});

await step('新版本下载好（模拟）', async () => {
  await app.evaluate(() => {
    const u = process.mainModule?.require('electron-updater');
    u?.autoUpdater.emit('update-downloaded', { version: '2.0.0' });
  });
  await sleep(1500);
  screen('update-downloaded-bar');
});

await step('关窗口缩到托盘', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setBounds({ x: 30, y: 20, width: 900, height: 650 });
    w.close();
  });
  await sleep(1500);
  note('关掉后', await winInfo(app));
  screen('closed-to-tray');
});

// 真的退出，再打开：窗口回到刚才的位置
await step('记住窗口', async () => {
  await app.evaluate(({ app: a }) => a.exit(0));
  await sleep(2000);
  app = await launch('reopen');
  await app.firstWindow();
  await sleep(1500);
  note('再打开', await winInfo(app));
  screen('reopen-splash-dark');
  await (await app.firstWindow()).waitForURL(/^http:\/\/127\.0\.0\.1/, { timeout: 60_000 });
  await sleep(3000);
  note('缩放还在', (await winInfo(app))?.zoom);
  screen('reopen-admin');
});

fs.writeFileSync(path.join(out, 'notes.txt'), notes.join('\n') + '\n');
await app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
process.exit(0);
