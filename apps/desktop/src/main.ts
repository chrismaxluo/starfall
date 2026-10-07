// 星临电脑版：主进程。
// 在独立进程里启动本机服务（和服务器版同一套代码），打开管理后台窗口；
// 关闭窗口缩到托盘（特效照常播放），可选开机自动启动，有新版本时提示更新。
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeTheme, shell, Tray, utilityProcess } from 'electron';
import type { MenuItemConstructorOptions, UtilityProcess } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const NAME = '星临';
const DEFAULT_PORT = 17520;
/** 开机自动启动时带上这个参数：只在托盘里运行，不弹出窗口 */
const HIDDEN_ARG = '--hidden';

// 数据放在 %APPDATA%\Starfall（英文目录名，避免个别软件处理不了中文路径）
app.setPath('userData', path.join(app.getPath('appData'), 'Starfall'));
const USER_DIR = app.getPath('userData');
const DATA_DIR = path.join(USER_DIR, 'data');
const LOG_DIR = path.join(USER_DIR, 'logs');
const STATE_FILE = path.join(USER_DIR, 'desktop.json');
/** 管理后台、特效页、数据库迁移文件：打包时放在安装目录的 resources 下 */
const RES = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), '..', 'stage-res');
const ICON = path.join(__dirname, 'icon.ico');

// ---------- 日志 ----------

fs.mkdirSync(LOG_DIR, { recursive: true });
/** 超过 10MB 换新文件，旧的留一份 */
function openLog(name: string): fs.WriteStream {
  const file = path.join(LOG_DIR, `${name}.log`);
  try {
    if (fs.statSync(file).size > 10 * 1024 * 1024) fs.renameSync(file, path.join(LOG_DIR, `${name}.old.log`));
  } catch {
    // 文件还不存在
  }
  return fs.createWriteStream(file, { flags: 'a' });
}
const mainLog = openLog('main');
const serverLog = openLog('server');
function log(...parts: unknown[]): void {
  const text = parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  mainLog.write(`${new Date().toISOString()} ${text}\n`);
}
process.on('uncaughtException', (e) => log('未处理的异常', e));
process.on('unhandledRejection', (e) => log('未处理的异步错误', e));

// ---------- 小设置（端口、是否提示过缩到托盘） ----------

interface DesktopState {
  port?: number;
  trayTipShown?: boolean;
}
function readState(): DesktopState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as DesktopState;
  } catch {
    return {};
  }
}
function writeState(patch: DesktopState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch (e) {
    log('保存设置失败', e);
  }
}

// ---------- 只允许运行一个 ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  void app.whenReady().then(start);
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: UtilityProcess | null = null;
let port = DEFAULT_PORT;
let quitting = false;
const base = () => `http://127.0.0.1:${port}`;

async function start(): Promise<void> {
  app.setAppUserModelId('io.github.chrismaxluo.starfall');
  log(`启动 ${NAME} ${app.getVersion()}`);
  setupIpc();
  createTray();
  try {
    const state = readState();
    port = await freePort(state.port ?? DEFAULT_PORT);
    await startServer();
    if (state.port && state.port !== port) {
      void dialog.showMessageBox({ type: 'warning', title: NAME, message: `端口 ${state.port} 被别的软件占用，这次改用 ${port}`, detail: '直播软件里的特效地址要换成新的：打开星临后台 →「直播软件输出」复制。' });
    }
    writeState({ port });
  } catch (e) {
    log('服务启动失败', e);
    await dialog.showMessageBox({ type: 'error', title: NAME, message: '星临服务启动失败', detail: `${(e as Error).message}\n\n日志在：${LOG_DIR}` });
    quitting = true;
    app.quit();
    return;
  }
  createWindow(!process.argv.includes(HIDDEN_ARG));
  void registerHotkeys();
  if (app.isPackaged) setupUpdates();
}

// ---------- 本机服务（独立进程） ----------

/** 从 preferred 开始找一个能用的端口（一般就是上次用的那个，特效地址不变） */
async function freePort(preferred: number): Promise<number> {
  for (let p = preferred; p < preferred + 20; p++) if (await canListen(p)) return p;
  throw new Error(`端口 ${preferred}–${preferred + 19} 都被占用了`);
}
function canListen(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/** 最近的意外退出时间：1 分钟内退出 3 次就不再自动重启 */
let crashes: number[] = [];

function startServer(): Promise<void> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    STARFALL_DESKTOP: '1',
    STARFALL_PORT: String(port),
    STARFALL_DATA: DATA_DIR,
    STARFALL_ADMIN_DIST: path.join(RES, 'admin'),
    STARFALL_OVERLAY_DIST: path.join(RES, 'overlay'),
    STARFALL_MIGRATIONS: path.join(RES, 'drizzle'),
  };
  return new Promise((resolve, reject) => {
    let ready = false;
    const child = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], { serviceName: `${NAME}服务`, stdio: 'pipe', env, execArgv: ['--enable-source-maps'] });
    server = child;
    child.stdout?.on('data', (d: Buffer) => serverLog.write(d));
    child.stderr?.on('data', (d: Buffer) => serverLog.write(d));
    child.on('message', (m: { type?: string; message?: string }) => {
      if (m?.type === 'ready') {
        ready = true;
        log(`服务已启动：${base()}`);
        resolve();
      } else if (m?.type === 'fatal') {
        reject(new Error(m.message ?? '未知错误'));
      }
    });
    child.on('exit', (code) => {
      if (server === child) server = null;
      if (!ready) return reject(new Error(`服务进程退出（${code}）`));
      if (quitting) return;
      log(`服务意外退出（${code}）`);
      const now = Date.now();
      crashes = [...crashes.filter((t) => now - t < 60_000), now];
      if (crashes.length >= 3) {
        void dialog
          .showMessageBox({ type: 'error', title: NAME, message: '星临服务多次意外退出，已停止自动重启', detail: `请把日志发给开发者：${LOG_DIR}`, buttons: ['打开日志文件夹', '关闭'] })
          .then((r) => {
            if (r.response === 0) void shell.openPath(LOG_DIR);
          });
        return;
      }
      setTimeout(() => {
        startServer().then(
          () => win?.webContents.reload(),
          (e: Error) => log('重启服务失败', e),
        );
      }, 1000);
    });
  });
}

/** 让服务自己收尾（断开直播间、关数据库），5 秒还没退就强制结束 */
function stopServer(): Promise<void> {
  const child = server;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.postMessage({ type: 'stop' });
  });
}

/** 调本机服务的接口（主进程没有 Origin，电脑版不用登录） */
async function api<T>(url: string): Promise<T> {
  const res = await fetch(`${base()}${url}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

// ---------- 素材快捷播放的全局快捷键 ----------
// 在直播姬、游戏等别的窗口里按也能播放。启动时注册，后台保存按钮后重新注册（sf:reload-hotkeys）

/** 重新注册：读快捷播放按钮，带全局快捷键的注册上；返回被别的软件占用、注册不上的 */
async function registerHotkeys(): Promise<{ failed: string[] }> {
  globalShortcut.unregisterAll();
  let buttons: Array<{ id: number; globalHotkey: string | null }>;
  try {
    buttons = (await api<{ buttons: Array<{ id: number; globalHotkey: string | null }> }>('/api/quickplay/buttons')).buttons;
  } catch (e) {
    log('读取快捷播放按钮失败', e);
    return { failed: [] };
  }
  const failed: string[] = [];
  let n = 0;
  for (const b of buttons) {
    if (!b.globalHotkey) continue;
    // 修改类接口只接受 JSON
    const play = () =>
      void fetch(`${base()}/api/quickplay/play/${b.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) })
        .then(async (r) => r.ok || log(`全局快捷键 ${b.globalHotkey} 没有播放：${r.status} ${await r.text()}`))
        .catch((e: unknown) => log(`全局快捷键 ${b.globalHotkey} 没有播放`, e));
    let ok = false;
    try {
      ok = globalShortcut.register(b.globalHotkey, play);
    } catch (e) {
      log(`全局快捷键 ${b.globalHotkey} 写法不对`, e);
    }
    if (ok) n++;
    else failed.push(b.globalHotkey);
  }
  log(`全局快捷键：注册了 ${n} 个${failed.length ? `；被别的软件占用：${failed.join('、')}` : ''}`);
  return { failed };
}

// ---------- 窗口 ----------

function createWindow(show: boolean): void {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: NAME,
    icon: ICON,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0c10' : '#f6f7f9',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.removeMenu();
  if (show) win.once('ready-to-show', () => win?.show());
  // 关闭 = 缩到托盘，特效照常播放；真正退出用托盘菜单
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    if (!readState().trayTipShown) {
      tray?.displayBalloon({ iconType: 'info', title: NAME, content: '星临还在后台运行，直播特效照常播放。要退出请右键托盘图标 →「退出星临」。' });
      writeState({ trayTipShown: true });
    }
  });
  // 外部链接（B 站主页、帮助文档等）用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`${base()}/`) || url === base()) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  // F5 刷新、F12 开发者工具（排查问题用）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') win?.webContents.reload();
    else if (input.key === 'F12') win?.webContents.toggleDevTools();
    else return;
    e.preventDefault();
  });
  win.webContents.on('render-process-gone', (_e, d) => log('后台页面崩溃', d.reason));
  void win.loadURL(`${base()}/`);
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- 托盘 ----------

function createTray(): void {
  tray = new Tray(ICON);
  tray.setToolTip(NAME);
  tray.on('click', showWindow);
  tray.on('right-click', () => {
    void trayMenu().then((m) => tray?.popUpContextMenu(m));
  });
}

interface OutputDto {
  id: number;
  name: string;
  path: string;
  chatPath: string;
  chatEnabled: boolean;
}

async function trayMenu(): Promise<Menu> {
  const outputs = server ? await api<{ outputs: OutputDto[] }>('/api/outputs').then((r) => r.outputs, () => []) : [];
  const copy: MenuItemConstructorOptions[] = outputs.flatMap((o) => [
    { label: `${o.name || '输出'}：特效`, click: () => copyUrl(`${base()}${o.path}`) },
    ...(o.chatEnabled ? [{ label: `${o.name || '输出'}：弹幕列表`, click: () => copyUrl(`${base()}${o.chatPath}`) }] : []),
  ]);
  return Menu.buildFromTemplate([
    { label: '打开星临', click: showWindow },
    { label: '复制直播软件地址', submenu: copy.length ? copy : [{ label: server ? '还没有输出' : '服务没有运行', enabled: false }] },
    { type: 'separator' },
    { label: '开机自动启动', type: 'checkbox', checked: autoStart(), click: (item) => setAutoStart(item.checked) },
    { label: '检查更新', enabled: app.isPackaged, click: () => void checkUpdate(true) },
    { label: '打开数据文件夹', click: () => void shell.openPath(USER_DIR) },
    { type: 'separator' },
    { label: '退出星临', click: () => void quit() },
  ]);
}

function copyUrl(url: string): void {
  clipboard.writeText(url);
  tray?.displayBalloon({ iconType: 'info', title: '已复制', content: url });
}

/** 正在直播时先确认：退出后直播画面上的特效会停 */
async function quit(): Promise<void> {
  const live = await api<{ live?: { live?: boolean } }>('/api/status').then((s) => s.live?.live === true, () => false);
  if (live) {
    const r = await dialog.showMessageBox({ type: 'warning', title: NAME, message: '正在直播，确定退出星临吗？', detail: '退出后直播画面上的特效和弹幕列表都会停止。', buttons: ['退出', '取消'], defaultId: 1, cancelId: 1 });
    if (r.response !== 0) return;
  }
  quitting = true;
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
});
// 退出前先让服务收尾
let stopped = false;
app.on('will-quit', (e) => {
  globalShortcut.unregisterAll();
  if (stopped || !server) return;
  e.preventDefault();
  void stopServer().then(() => {
    stopped = true;
    app.quit();
  });
});
// 窗口只是隐藏，不会全部关闭；这里兜底，不让程序因为没有窗口而退出
app.on('window-all-closed', () => undefined);

// ---------- 开机自动启动 ----------

const autoStart = () => app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin;
function setAutoStart(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_ARG] });
  log(`开机自动启动：${on ? '开' : '关'}`);
}

// ---------- 检查更新（GitHub 发布页） ----------

let updateBusy = false;

function setupUpdates(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // 测试版也收到测试版更新；正式版只收正式版
  autoUpdater.allowPrerelease = app.getVersion().includes('-');
  autoUpdater.logger = { info: (m: unknown) => log('[更新]', m), warn: (m: unknown) => log('[更新]', m), error: (m: unknown) => log('[更新]', m), debug: () => undefined };
  autoUpdater.on('download-progress', (p) => {
    win?.setProgressBar(p.percent / 100);
    tray?.setToolTip(`${NAME} · 正在下载新版本 ${Math.floor(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    win?.setProgressBar(-1);
    tray?.setToolTip(NAME);
    void dialog
      .showMessageBox({ type: 'info', title: NAME, message: `新版本 ${info.version} 已下载好`, detail: '现在重启就会安装（大约半分钟）。正在直播的话，建议下播后再装；选「以后」会在你退出星临时自动安装。', buttons: ['现在重启并安装', '以后'], defaultId: 0, cancelId: 1 })
      .then((r) => {
        if (r.response !== 0) return;
        quitting = true;
        // 先让服务收尾，再交给安装程序
        void stopServer().then(() => {
          stopped = true;
          autoUpdater.quitAndInstall(false, true);
        });
      });
  });
  setTimeout(() => void checkUpdate(false), 10_000);
  setInterval(() => void checkUpdate(false), 6 * 3600_000);
}

/** manual：用户点了「检查更新」，没有新版本或出错也要告诉他 */
async function checkUpdate(manual: boolean): Promise<void> {
  if (updateBusy) {
    if (manual) void dialog.showMessageBox({ type: 'info', title: NAME, message: '正在检查或下载更新，请稍等' });
    return;
  }
  updateBusy = true;
  try {
    const r = await autoUpdater.checkForUpdates();
    const next = r?.isUpdateAvailable ? r.updateInfo.version : null;
    if (!next) {
      if (manual) await dialog.showMessageBox({ type: 'info', title: NAME, message: '已经是最新版本', detail: `当前版本 ${app.getVersion()}` });
      return;
    }
    const a = await dialog.showMessageBox({ type: 'info', title: NAME, message: `星临有新版本 ${next}`, detail: `当前版本 ${app.getVersion()}。现在下载吗？在后台下载，不影响直播。`, buttons: ['下载', '以后再说'], defaultId: 0, cancelId: 1 });
    if (a.response === 0) await autoUpdater.downloadUpdate();
  } catch (e) {
    log('检查更新失败', e);
    win?.setProgressBar(-1);
    tray?.setToolTip(NAME);
    if (manual) await dialog.showMessageBox({ type: 'error', title: NAME, message: '检查更新失败', detail: `${(e as Error).message}\n\n可以稍后再试，或者到 GitHub 发布页手动下载。` });
  } finally {
    updateBusy = false;
  }
}

// ---------- 给后台页面用的功能（设置页的「电脑版」卡片） ----------

function setupIpc(): void {
  // 只回应星临自己的后台页面
  const ours = (e: Electron.IpcMainInvokeEvent) => {
    try {
      return new URL(e.senderFrame?.url ?? '').origin === base();
    } catch {
      return false;
    }
  };
  const handle = (channel: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args: unknown[]) => {
      if (!ours(e)) throw new Error('不允许');
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  handle('sf:info', () => ({ version: app.getVersion(), autoStart: autoStart(), canUpdate: app.isPackaged, dataDir: USER_DIR }));
  handle('sf:set-auto-start', (on: boolean) => {
    setAutoStart(Boolean(on));
    return autoStart();
  });
  handle('sf:check-update', () => void checkUpdate(true));
  handle('sf:reload-hotkeys', () => registerHotkeys());
  handle('sf:open-data', () => void shell.openPath(USER_DIR));
  handle('sf:open-logs', () => void shell.openPath(LOG_DIR));
}
