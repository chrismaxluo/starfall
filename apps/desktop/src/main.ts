// 星临桌面版：主进程。
// 在独立进程里启动本机服务（和服务器版同一套代码），打开管理后台窗口；
// 关闭窗口缩到托盘（特效照常播放），可选开机自动启动，有新版本时提示更新。
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeTheme, screen, shell, Tray, utilityProcess } from 'electron';
import type { MenuItemConstructorOptions, MessageBoxOptions, MessageBoxReturnValue, Rectangle, UtilityProcess } from 'electron';
import { autoUpdater, CancellationToken } from 'electron-updater';
import type { ProgressInfo } from 'electron-updater';
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js';
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';
import type { ResolvedUpdateFileInfo } from 'electron-updater/out/types.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fixText, HOME_PORT, planPorts } from './ports.ts';
import { placeWindow, trayStatus, zoomStep } from './ui.ts';
import type { SavedWindow, StatusLite } from './ui.ts';
import { downloadSources, normalizeMirror, r2ChannelUrl, sourceName, SpeedWatch, viaMirror } from './sources.ts';
import { findStreamApp } from './stream-apps.ts';

const NAME = '星临';
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
const LOG_MAX = 10 * 1024 * 1024;
const openLog = (name: string) => fs.createWriteStream(path.join(LOG_DIR, `${name}.log`), { flags: 'a' });
let mainLog = openLog('main');
let serverLog = openLog('server');
/**
 * 超过 10MB 换新文件，旧的留一份。启动后（拿到「只运行一个」之后）查一次，之后每小时查一次：
 * 开机自启后可能连着运行好几周；第二次双击打开的那个进程不能动正在写的日志
 */
function rotateLogs(): void {
  for (const name of ['main', 'server'] as const) {
    const file = path.join(LOG_DIR, `${name}.log`);
    try {
      if (fs.statSync(file).size <= LOG_MAX) continue;
      (name === 'main' ? mainLog : serverLog).end();
      fs.renameSync(file, path.join(LOG_DIR, `${name}.old.log`));
    } catch {
      continue;
    }
    if (name === 'main') mainLog = openLog('main');
    else serverLog = openLog('server');
  }
}
function log(...parts: unknown[]): void {
  const text = parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  mainLog.write(`${new Date().toISOString()} ${text}\n`);
}
process.on('uncaughtException', (e) => log('未处理的异常', e));
process.on('unhandledRejection', (e) => log('未处理的异步错误', e));

// ---------- 小设置（端口、是否提示过缩到托盘、自己填的备用下载地址） ----------

interface DesktopState {
  /** 上次用的端口（旧版本只记这一个） */
  port?: number;
  /** 用过的端口，新的在前（ports.ts） */
  usedPorts?: number[];
  trayTipShown?: boolean;
  /** 下载新版本时，GitHub 直连不行先试这个地址（加速站），再试内置的 */
  updateMirror?: string | null;
  /** 后台选的亮色 / 暗色（标题栏、启动画面、窗口底色跟着它）；没选过为跟随系统 */
  theme?: ThemeChoice;
  /** 上次窗口的位置、大小、是否最大化 */
  win?: SavedWindow;
  /** 后台页面的缩放（Ctrl 加号、减号、滚轮），0 为原样 */
  zoom?: number;
}

type ThemeChoice = 'light' | 'dark' | 'system';
/** 和后台的底色一样（apps/admin/src/styles/app.css 的 --l1），打开时不闪别的颜色 */
const BG = { light: '#F4F1EC', dark: '#13110E' } as const;
const bgColor = () => (nativeTheme.shouldUseDarkColors ? BG.dark : BG.light);
function themeChoice(): ThemeChoice {
  const t = readState().theme;
  return t === 'light' || t === 'dark' ? t : 'system';
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
  rotateLogs();
  setInterval(rotateLogs, 3600_000).unref();
  void app.whenReady().then(start);
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: UtilityProcess | null = null;
let port = HOME_PORT;
/** 同时接收连接的以前用过的端口 */
let extraPorts: number[] = [];
let quitting = false;
const base = () => `http://127.0.0.1:${port}`;

async function start(): Promise<void> {
  app.setAppUserModelId('io.github.chrismaxluo.starfall');
  log(`启动 ${NAME} ${app.getVersion()}`);
  setupIpc();
  createTray();
  // 第一次运行（新安装）：还没有小设置文件
  const fresh = !fs.existsSync(STATE_FILE);
  // 标题栏、窗口底色先按后台上次选的亮色 / 暗色
  nativeTheme.themeSource = themeChoice();
  // 一双击就有窗口：服务启动的这几秒先显示启动画面，好了自动换成后台（开机自动启动时只在托盘里）
  createWindow(!process.argv.includes(HIDDEN_ARG));
  try {
    const state = readState();
    const plan = await planPorts(state.usedPorts ?? (state.port ? [state.port] : []), canListen);
    port = plan.port;
    extraPorts = plan.extra;
    fxHint = hintFor(null);
    await startServer();
    // 端口变了不弹窗：直播软件里的特效页连不上时，后台顶部和托盘会说怎么办（watchFx）
    if (port !== HOME_PORT) log(`端口 ${HOME_PORT} 用不了，这次改用 ${port}`);
    writeState({ port, usedPorts: plan.used });
  } catch (e) {
    log('服务启动失败', e);
    await ask({ type: 'error', title: NAME, message: '星临服务启动失败', detail: `${(e as Error).message}\n\n日志在：${LOG_DIR}` });
    quitting = true;
    app.quit();
    return;
  }
  // 新安装默认开机自动启动：开机后星临先在托盘里运行，直播软件里的特效页一打开就能连上
  if (fresh && app.isPackaged) setAutoStart(true);
  openAdmin();
  // 开机时有快捷键被别的软件占着：托盘提示一下（以前只写日志，主播不知道）
  void registerHotkeys(true).then(({ failed }) => {
    if (failed.length) notify({ iconType: 'warning', title: NAME, content: `全局快捷键 ${failed.join('、')} 被别的软件占用了，暂时按了没反应；对方关掉后会自动恢复。` });
  });
  setInterval(() => void registerHotkeys(), 30_000);
  startedAt = Date.now();
  void watchFx();
  setInterval(() => void watchFx(), WATCH_MS);
  if (app.isPackaged) setupUpdates();
}

// ---------- 本机服务（独立进程） ----------

/** 这个端口现在能不能用（被别的程序占用、或者被 Windows 保留时不能用） */
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
    // 打包后服务找不到 apps/server/package.json，版本号从这里告诉它（「关于」页显示）
    STARFALL_VERSION: app.getVersion(),
    STARFALL_PORT: String(port),
    STARFALL_EXTRA_PORTS: extraPorts.join(','),
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
      // 后台页面顶部说「正在重新启动」；连上后页面自己补回数据，不整页刷新（正在填的东西不会丢）
      win?.webContents.send('sf:server', 'restarting');
      const now = Date.now();
      crashes = [...crashes.filter((t) => now - t < 60_000), now];
      if (crashes.length >= 3) return crashDialog();
      restartLater(1000);
    });
  });
}

/** 服务意外退出后重新启动；重启本身也失败时（例如端口被占、数据库被锁）隔 5 秒再试，一分钟里失败 3 次就停下并弹窗 */
function restartLater(ms: number): void {
  setTimeout(() => {
    startServer().then(
      () => win?.webContents.send('sf:server', 'ok'),
      (e: Error) => {
        log('重启服务失败', e);
        if (quitting) return;
        const now = Date.now();
        crashes = [...crashes.filter((t) => now - t < 60_000), now];
        if (crashes.length >= 3) crashDialog();
        else restartLater(5000);
      },
    );
  }, ms);
}

function crashDialog(): void {
  tray?.setToolTip(`${NAME} · 服务已停止`);
  win?.webContents.send('sf:server', 'stopped');
  void ask({ type: 'error', title: NAME, message: '星临服务多次意外退出，已停止自动重启', detail: `直播画面上的特效和弹幕列表现在不会更新。可以退出星临再打开；还不行的话请把日志发给开发者：${LOG_DIR}`, buttons: ['打开日志文件夹', '关闭'] })
    .then((r) => {
      if (r.response === 0) void shell.openPath(LOG_DIR);
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

/** 调本机服务的接口（主进程没有 Origin，桌面版不用登录） */
async function api<T>(url: string): Promise<T> {
  const res = await fetch(`${base()}${url}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

// ---------- 素材快捷播放、弹幕点歌（切歌、暂停）的全局快捷键 ----------
// 在直播姬、游戏等别的窗口里按也能播放。按快捷键找按钮播放（保存按钮后按钮编号会变，快捷键不会）。
// 启动时注册；之后每 30 秒看一次按钮有没有变（在浏览器里改按钮、导入配置也能跟上），后台保存按钮后立即重新注册（sf:reload-hotkeys）。
// 后台编辑快捷播放按钮时先全部注销（sf:pause-hotkeys），不然录快捷键时按下已有的组合会被系统先拦走、直接播出来

let hotkeysPaused = false;
/** 现在注册着的快捷键（排好序拼起来，用来判断按钮有没有变） */
let hotkeysNow = '';
/** 被别的软件占着、没注册上的全局快捷键：每 30 秒再试一次 */
const retryKeys = new Map<string, () => void>();

async function registerHotkeys(force = false): Promise<{ failed: string[] }> {
  if (hotkeysPaused && !force) return { failed: [] };
  hotkeysPaused = false;
  clearTimeout(pauseTimer);
  let keys: string[];
  try {
    keys = (await api<{ buttons: Array<{ globalHotkey: string | null }> }>('/api/quickplay/buttons')).buttons.flatMap((b) => (b.globalHotkey ? [b.globalHotkey] : []));
  } catch (e) {
    log('读取快捷播放按钮失败', e);
    return { failed: [] };
  }
  // 弹幕点歌的切歌、暂停 / 继续（读不到不影响快捷播放）
  const music: Record<string, string> = {};
  try {
    const m = (await api<{ settings: { hotkeySkip?: string | null; hotkeyPause?: string | null } }>('/api/music')).settings;
    if (m.hotkeySkip) music[m.hotkeySkip] = '/api/music/skip';
    if (m.hotkeyPause) music[m.hotkeyPause] = '/api/music/toggle-pause';
  } catch (e) {
    log('读取点歌快捷键失败', e);
  }
  const sig = [...keys, ...Object.entries(music).map(([k, v]) => `${k}=${v}`)].sort().join(' ');
  if (!force && sig === hotkeysNow) {
    // 没变：上次被别的软件占着的再试一次（对方关了就能用上了）
    for (const [hotkey, fn] of retryKeys) {
      let ok = false;
      try {
        ok = globalShortcut.register(hotkey, fn);
      } catch {
        /* 写法不对的不会好，下次还是失败 */
      }
      if (ok) {
        retryKeys.delete(hotkey);
        log(`全局快捷键 ${hotkey} 现在能用了`);
      }
    }
    return { failed: [...retryKeys.keys()] };
  }
  globalShortcut.unregisterAll();
  hotkeysNow = sig;
  retryKeys.clear();
  const failed: string[] = [];
  for (const hotkey of keys) {
    // 修改类接口只接受 JSON
    const play = () =>
      void fetch(`${base()}/api/quickplay/play-global`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hotkey }), signal: AbortSignal.timeout(3000) })
        .then(async (r) => r.ok || log(`全局快捷键 ${hotkey} 没有播放：${r.status} ${await r.text()}`))
        .catch((e: unknown) => log(`全局快捷键 ${hotkey} 没有播放`, e));
    let ok = false;
    try {
      ok = globalShortcut.register(hotkey, play);
    } catch (e) {
      log(`全局快捷键 ${hotkey} 写法不对`, e);
    }
    if (!ok) {
      failed.push(hotkey);
      retryKeys.set(hotkey, play);
    }
  }
  for (const [hotkey, url] of Object.entries(music)) {
    const run = () =>
      void fetch(`${base()}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) })
        .then(async (r) => r.ok || log(`点歌快捷键 ${hotkey} 没有生效：${r.status} ${await r.text()}`))
        .catch((e: unknown) => log(`点歌快捷键 ${hotkey} 没有生效`, e));
    let ok = false;
    try {
      ok = globalShortcut.register(hotkey, run);
    } catch (e) {
      log(`点歌快捷键 ${hotkey} 写法不对`, e);
    }
    if (!ok) {
      failed.push(hotkey);
      retryKeys.set(hotkey, run);
    }
  }
  const total = keys.length + Object.keys(music).length;
  log(`全局快捷键：注册了 ${total - failed.length} 个${failed.length ? `；被别的软件占用：${failed.join('、')}` : ''}`);
  return { failed };
}

let pauseTimer: ReturnType<typeof setTimeout> | undefined;
function pauseHotkeys(): void {
  hotkeysPaused = true;
  hotkeysNow = '';
  retryKeys.clear();
  globalShortcut.unregisterAll();
  // 编辑到一半关了窗口也不会一直停着：10 分钟后自己恢复
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => void registerHotkeys(true), 10 * 60_000);
}

// ---------- 特效页没连上的提醒 ----------
// 直播软件比星临先打开时，特效页（浏览器源）第一次没打开，直播软件不会自己再试。新版特效页会自动连上（overlay/public/sw.js）；
// 万一这个直播软件不支持：发现直播软件开着、特效页却一直没连上，就在后台顶部和托盘提醒怎么办。
// 特效页在线时不去列正在运行的程序

/** 推给后台页面：顶部提醒条用 */
interface FxHint {
  /** 开着、但特效页一直没连上的直播软件；没有为 null */
  app: string | null;
  /** 这次用的端口，和平时的端口 */
  port: number;
  home: number;
  /** 特效页没连上时怎么办 */
  fix: string;
}

const WATCH_MS = 10_000;
/** 直播软件开着这么久、特效页还没连上才提醒（刚打开时特效页正在加载） */
const GRACE_MS = 15_000;
let startedAt = 0;
const hintFor = (appName: string | null): FxHint => ({ app: appName, port, home: HOME_PORT, fix: fixText(appName ?? '直播软件', port) });
let fxHint: FxHint = hintFor(null);
/** 什么时候开始看到这个直播软件开着 */
let appSeen: { name: string; since: number } | null = null;
/** 这次打开直播软件后已经弹过托盘通知（关掉直播软件或特效页连上后重新算） */
let notified = false;
let watching = false;

function setHint(h: FxHint): void {
  if (JSON.stringify(h) === JSON.stringify(fxHint)) return;
  fxHint = h;
  win?.webContents.send('sf:fx-hint', h);
}

/** 正在运行的直播软件（直播姬、OBS），都没开为 null */
function runningStreamApp(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? null : findStreamApp(String(out))));
  });
}

async function watchFx(): Promise<void> {
  if (watching || !server) return;
  watching = true;
  try {
    const status = await api<StatusLite>('/api/status').catch(() => null);
    showStatus(status);
    if (!status) return;
    const name = (status.overlays ?? 0) > 0 ? null : await runningStreamApp();
    if (!name) {
      appSeen = null;
      notified = false;
      return setHint(hintFor(null));
    }
    const now = Date.now();
    if (appSeen?.name !== name) appSeen = { name, since: now };
    if (now - appSeen.since < GRACE_MS || now - startedAt < GRACE_MS) return;
    // 还没把特效页加到直播软件过：新手引导会带着加，不用提醒刷新
    const seen = await api<{ overlaySeen?: boolean }>('/api/settings').then((x) => x.overlaySeen === true, () => true);
    if (!seen) return;
    setHint(hintFor(name));
    if (notified) return;
    notified = true;
    notify({ iconType: 'warning', title: `${name}已经打开，但特效页没连上`, content: fxHint.fix });
  } finally {
    watching = false;
  }
}

// ---------- 窗口 ----------

/** 这次打开窗口时要不要最大化（开机自动启动时窗口先藏着，第一次叫出来时再最大化） */
let maxOnShow = false;
/** 第一次显示过窗口了 */
let shownOnce = false;
/** 后台页面最近崩溃的时间：一分钟里 3 次就不再自动重新打开 */
let pageCrashes: number[] = [];

function createWindow(show: boolean): void {
  // 记住上次的大小、位置、在哪块屏幕；副屏拔掉了回到主屏；第一次按屏幕大小来定（笔记本小屏幕也放得下）
  const place = placeWindow(readState().win, screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea);
  maxOnShow = place.maximized;
  win = new BrowserWindow({
    ...place.bounds,
    minWidth: place.minWidth,
    minHeight: place.minHeight,
    title: NAME,
    icon: ICON,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: bgColor(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.removeMenu();
  if (show) win.once('ready-to-show', showWindow);
  // 关闭 = 缩到托盘，特效照常播放；真正退出用托盘菜单
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    saveWindow();
    win?.hide();
    if (!readState().trayTipShown) {
      tray?.displayBalloon({ iconType: 'info', title: NAME, content: '星临还在后台运行，直播特效照常播放。要退出请右键任务栏右下角的星临图标（可能收在「^」里）→「退出星临」。' });
      writeState({ trayTipShown: true });
    }
  });
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev as 'resize', saveWindowSoon);
  // 页面有没保存的修改时（刷新、退出）：Electron 默认悄悄取消，不弹提示。退出前已经确认过的直接放行，其余情况问一下
  win.webContents.on('will-prevent-unload', (e) => {
    if (allowUnload) return e.preventDefault();
    const r = dialog.showMessageBoxSync(win!, { type: 'warning', title: NAME, message: '有修改还没保存', detail: '离开后这些修改会丢掉。', buttons: ['离开', '留下'], defaultId: 1, cancelId: 1 });
    if (r === 0) e.preventDefault();
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
  // F5 刷新、F12 开发者工具（排查问题用）；Ctrl 加号、减号、0 放大缩小（和浏览器一样）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const z = input.control && !input.alt && !input.meta ? zoomStep(input.key) : null;
    if (input.key === 'F5') win?.webContents.reload();
    else if (input.key === 'F12') win?.webContents.toggleDevTools();
    else if (z !== null) setZoom(z === 0 ? 0 : (win?.webContents.getZoomLevel() ?? 0) + z);
    else return;
    e.preventDefault();
  });
  // 按住 Ctrl 转滚轮
  win.webContents.on('zoom-changed', (_e, dir) => setZoom((win?.webContents.getZoomLevel() ?? 0) + (dir === 'in' ? 0.5 : -0.5)));
  win.webContents.on('did-finish-load', () => {
    if (isAdminUrl(win?.webContents.getURL() ?? '')) win?.webContents.setZoomLevel(readState().zoom ?? 0);
  });
  // 右键：输入框里剪切、复制、粘贴、全选；选中的文字可以复制
  win.webContents.on('context-menu', (_e, p) => {
    const f = p.editFlags;
    const items: MenuItemConstructorOptions[] = p.isEditable
      ? [{ label: '剪切', role: 'cut', enabled: f.canCut }, { label: '复制', role: 'copy', enabled: f.canCopy }, { label: '粘贴', role: 'paste', enabled: f.canPaste }, { type: 'separator' }, { label: '全选', role: 'selectAll', enabled: f.canSelectAll }]
      : p.selectionText.trim()
        ? [{ label: '复制', role: 'copy' }]
        : /^https?:\/\//.test(p.linkURL)
          ? [{ label: '复制链接地址', click: () => clipboard.writeText(p.linkURL) }]
          : [];
    if (items.length && win) Menu.buildFromTemplate(items).popup({ window: win });
  });
  // 后台页面崩溃（很少见，比如电脑内存不够）：自动重新打开，并告诉主播已经恢复；特效不受影响（由后台服务负责）
  win.webContents.on('render-process-gone', (_e, d) => {
    log('后台页面崩溃', d.reason);
    if (quitting || d.reason === 'clean-exit') return;
    const now = Date.now();
    pageCrashes = [...pageCrashes.filter((t) => now - t < 60_000), now];
    if (pageCrashes.length >= 3) {
      log('后台页面一分钟里崩溃 3 次，不再自动重新打开');
      void win?.loadURL(messagePage('后台页面反复出问题', '直播画面上的特效照常播放。可以点下面重新打开后台；还不行的话请退出星临再打开。', `${base()}/`, '重新打开后台'));
      return;
    }
    setTimeout(() => openAdmin('recovered=1'), 300);
  });
  // 页面卡住不动：窗口开着时问一下要不要重新加载（藏在托盘里时不打扰）
  win.on('unresponsive', () => {
    log('后台页面没有响应');
    if (!win?.isVisible()) return;
    void ask({ type: 'warning', title: NAME, message: '后台页面没有响应', detail: '可能是电脑太忙。直播画面上的特效不受影响。可以再等一等，或者重新加载后台页面（没保存的修改会丢掉）。', buttons: ['重新加载', '再等一等'], defaultId: 1, cancelId: 1 }).then((r) => {
      // 结束卡住的页面：上面的「崩溃后自动重新打开」会接着打开后台
      if (r.response === 0) win?.webContents.forcefullyCrashRenderer();
    });
  });
  // 打开后台失败（服务正好在重启）：过一会儿再打开
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3 || quitting || !isAdminUrl(url)) return;
    log('后台页面没打开', code);
    setTimeout(() => server && openAdmin(), 2000);
  });
  void win.loadURL(splashPage());
}

const isAdminUrl = (url: string) => url === base() || url.startsWith(`${base()}/`);
/** 打开后台页面；query 例如 recovered=1（后台会说一句「已经恢复」） */
function openAdmin(query = ''): void {
  if (!win || win.isDestroyed()) return;
  const hash = (() => {
    try {
      const u = new URL(win.webContents.getURL());
      return isAdminUrl(u.href) ? u.hash : '';
    } catch {
      return '';
    }
  })();
  void win.loadURL(`${base()}/${query ? `?${query}` : ''}${hash}`);
}

function setZoom(level: number): void {
  const z = Math.max(-3, Math.min(3, Math.round(level * 2) / 2));
  win?.webContents.setZoomLevel(z);
  writeState({ zoom: z });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveWindowSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWindow, 600);
}
function saveWindow(): void {
  clearTimeout(saveTimer);
  if (!win || win.isDestroyed() || win.isMinimized() || !shownOnce) return;
  const b: Rectangle = win.getNormalBounds();
  writeState({ win: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } });
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!shownOnce && maxOnShow) win.maximize();
  shownOnce = true;
  win.show();
  win.focus();
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** 启动画面、出错说明：不依赖服务的小页面，颜色跟着亮色 / 暗色 */
function plainPage(body: string): string {
  const dark = nativeTheme.shouldUseDarkColors;
  const fg = dark ? '#F2EDE6' : '#201B16';
  const sub = dark ? '#8D8479' : '#766C62';
  const accent = dark ? '#8D8BFF' : '#5451D6';
  let icon = '';
  try {
    icon = `<img src="data:image/x-icon;base64,${fs.readFileSync(ICON).toString('base64')}" alt="">`;
  } catch {
    /* 没有图标也能显示 */
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${NAME}</title><style>
html,body{margin:0;height:100%;background:${bgColor()};color:${fg};font-family:"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif;user-select:none;cursor:default}
body{display:grid;place-items:center}
.c{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;max-width:420px;padding:24px;animation:in .4s ease-out both}
img{width:64px;height:64px}
b{font-size:22px;font-weight:600;letter-spacing:.12em}
p{margin:0;font-size:13px;line-height:1.7;color:${sub}}
i{display:block;width:120px;height:3px;margin-top:6px;border-radius:2px;background:${dark ? 'rgba(255,240,220,.1)' : 'rgba(70,50,30,.1)'};overflow:hidden;position:relative}
i::after{content:"";position:absolute;inset:0;width:40%;border-radius:2px;background:${accent};animation:run 1.1s ease-in-out infinite}
a{margin-top:8px;padding:8px 18px;border-radius:999px;background:${accent};color:#fff;text-decoration:none;font-size:13px;font-weight:600}
@keyframes run{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@keyframes in{from{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){*,*::after{animation:none!important}}
</style></head><body><div class="c">${icon}${body}</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
const splashPage = () => plainPage(`<b>${NAME}</b><p>正在启动…</p><i></i>`);
const messagePage = (title: string, text: string, href: string, label: string) => plainPage(`<b>${esc(title)}</b><p>${esc(text)}</p><a href="${esc(href)}">${esc(label)}</a>`);

/** 系统对话框：窗口开着时挂在窗口上（不单独占任务栏、不跑到别的屏幕） */
function ask(opts: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  return win && win.isVisible() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

// ---------- 托盘 ----------

function createTray(): void {
  tray = new Tray(ICON);
  tray.setToolTip(`${NAME} · 正在启动…`);
  tray.on('click', showWindow);
  tray.on('balloon-click', showWindow);
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

// ---------- 藏在托盘里时也看得出状态 ----------
// 鼠标放在托盘图标上，用一句话说现在怎么样；出了问题、没在直播时提醒一次，正在直播时只改文字、不弹东西
// （直播时用「显示器采集」，系统通知会出现在直播画面上）。托盘图标上的小记号等新 logo 定了再画

/** 最近一次读到的状态 */
let lastStatus: StatusLite | null = null;
/** 已经提醒过的问题（问题没了再出现会重新提醒） */
let warned: string | null = null;
const isLive = () => lastStatus?.live?.live === true;

function showStatus(s: StatusLite | null): void {
  lastStatus = s;
  const t = trayStatus(s, Date.now());
  // 下载新版本时托盘显示下载进度
  if (updateState.phase !== 'downloading') tray?.setToolTip(t.text);
  if (!t.problem) {
    warned = null;
    return;
  }
  if (warned === t.problem.key) return;
  warned = t.problem.key;
  // 窗口开着：后台页面顶部已经说了
  if (win?.isVisible()) return;
  notify({ iconType: 'warning', title: t.problem.title, content: t.problem.text });
}

/** 托盘通知：正在直播时不弹 */
function notify(o: Electron.DisplayBalloonOptions): void {
  if (isLive()) return log('正在直播，不弹通知：', o.title, o.content);
  tray?.displayBalloon(o);
}

function copyUrl(url: string): void {
  clipboard.writeText(url);
  tray?.displayBalloon({ iconType: 'info', title: '已复制', content: url });
}

/** 后台页面已经确认过可以丢掉没保存的修改：关窗时不再拦 */
let allowUnload = false;

/**
 * 退出、安装更新前先问：后台有没保存的修改、正在直播时各确认一次。返回 false 表示不退出。
 * 页面有没保存的修改时 Electron 关窗会被悄悄取消（不弹提示），所以要先问清楚再停服务
 */
async function confirmExit(action: '退出星临' | '重启并安装'): Promise<boolean> {
  const unsaved = await (win?.webContents.executeJavaScript('Boolean(window.__starfallUnsaved && window.__starfallUnsaved())') ?? Promise.resolve(false)).catch(() => false);
  if (unsaved) {
    const r = await ask({ type: 'warning', title: NAME, message: '后台还有没保存的修改', detail: `${action}后这些修改会丢掉。`, buttons: [`仍要${action}`, '取消'], defaultId: 1, cancelId: 1 });
    if (r.response !== 0) return false;
  }
  const live = await api<{ live?: { live?: boolean } }>('/api/status').then((s) => s.live?.live === true, () => false);
  if (live) {
    const detail = action === '退出星临' ? '退出后直播画面上的特效和弹幕列表都会停止。' : '安装大约要半分钟，这期间直播画面上的特效和弹幕列表都会停止，建议下播后再装。';
    const r = await ask({ type: 'warning', title: NAME, message: `正在直播，确定${action}吗？`, detail, buttons: [action, '取消'], defaultId: 1, cancelId: 1 });
    if (r.response !== 0) return false;
  }
  allowUnload = true;
  return true;
}

async function quit(): Promise<void> {
  if (!(await confirmExit('退出星临'))) return;
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

// ---------- 检查更新（GitHub 发布页，连不上时用星临的备用下载地址） ----------

/** 这次下载用的加速站（null 为 GitHub 直连） */
let mirror: string | null = null;
/** 上次查新版本时 GitHub 连不上、改从星临的备用下载地址查的：下载时不再试 GitHub 直连 */
let githubDown = false;
/**
 * 和自带的 GitHub 来源一样（有没有新版本、latest.yml 里的校验值都直接问 GitHub），
 * 只是下载安装包和 blockmap 时可以换成加速站。GitHub 连不上时，改从星临的备用下载地址读 latest.yml（自己上传的，同样可信）。
 * electron-updater 版本是锁定的（package.json），升级时确认 getLatestVersion、resolveFiles 还是这样用
 */
type GitHubArgs = ConstructorParameters<typeof GitHubProvider>;
class MirrorProvider extends GitHubProvider {
  // setFeedURL 的设置原样传进来（provider 是 custom），按 GitHub 来源处理
  constructor(options: Record<string, unknown>, updater: GitHubArgs[1], runtime: GitHubArgs[2]) {
    super({ ...options, provider: 'github' } as GitHubArgs[0], updater, runtime);
  }
  override async getLatestVersion(): ReturnType<GitHubProvider['getLatestVersion']> {
    try {
      const info = await super.getLatestVersion();
      githubDown = false;
      return info;
    } catch (e) {
      const url = new URL(r2ChannelUrl(autoUpdater.allowPrerelease));
      log('[更新]', `GitHub 查不到新版本，改问星临的备用下载地址 ${url.href}`, e);
      let raw: string | null;
      try {
        raw = await this.httpRequest(url, { accept: '*/*', 'cache-control': 'no-cache' });
      } catch (e2) {
        log('[更新]', '星临的备用下载地址也查不到', e2);
        throw e;
      }
      const info = parseUpdateInfo(raw, path.basename(url.pathname), url);
      githubDown = true;
      // 标签和 GitHub 上的一样，下载地址照常按 GitHub 的算，再换成备用地址（resolveFiles）
      return { ...info, tag: `v${info.version}` };
    }
  }
  override resolveFiles(info: Parameters<GitHubProvider['resolveFiles']>[0]): ResolvedUpdateFileInfo[] {
    return super.resolveFiles(info).map((f) => ({ ...f, url: new URL(viaMirror(f.url.href, mirror)) }));
  }
}

let updateBusy = false;
/** 已经下载好、等重启安装的版本：后台定时检查时不再问 */
let downloaded: string | null = null;
/** 后台检查时问过、选了「以后再说」的版本：不再每 6 小时问一次（手动点「检查更新」时照样问） */
let declined: string | null = null;

/** 下载新版本的进度：推给后台页面，在窗口顶部显示（任务栏图标和托盘提示也会显示） */
interface UpdateState {
  /** available：有新版本，还没下载（后台顶部问要不要下载） */
  phase: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';
  version: string | null;
  percent: number;
  transferred: number;
  total: number;
  /** 每秒下载多少字节 */
  speed: number;
  error: string | null;
  /** 正在从哪里下载（GitHub 直连 / 备用地址 xxx） */
  source: string | null;
  /** 换过下载地址时说明原因，例如「GitHub 直连太慢，已改用备用地址 gh-proxy.com」 */
  note: string | null;
}
let updateState: UpdateState = { phase: 'idle', version: null, percent: 0, transferred: 0, total: 0, speed: 0, error: null, source: null, note: null };
function setUpdateState(patch: Partial<UpdateState>): void {
  updateState = { ...updateState, ...patch };
  win?.webContents.send('sf:update-state', updateState);
}

/** 先确认，再让服务收尾，最后交给安装程序 */
async function installNow(): Promise<void> {
  if (!(await confirmExit('重启并安装'))) return;
  quitting = true;
  void stopServer().then(() => {
    stopped = true;
    autoUpdater.quitAndInstall(false, true);
  });
}

function setupUpdates(): void {
  autoUpdater.setFeedURL({ provider: 'custom', updateProvider: MirrorProvider, owner: 'chrismaxluo', repo: 'starfall' });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // 测试版也收到测试版更新；正式版只收正式版
  autoUpdater.allowPrerelease = app.getVersion().includes('-');
  autoUpdater.logger = { info: (m: unknown) => log('[更新]', m), warn: (m: unknown) => log('[更新]', m), error: (m: unknown) => log('[更新]', m), debug: () => undefined };
  autoUpdater.on('download-progress', (p) => {
    setUpdateState({ phase: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total, speed: p.bytesPerSecond });
    win?.setProgressBar(p.percent / 100);
    tray?.setToolTip(`${NAME} · 正在下载新版本 ${Math.floor(p.percent)}%`);
  });
  // 下载好了：不弹系统对话框，在后台顶部说（正在直播时后台也先不说，等下播）；窗口藏着、没在直播时托盘提醒一次
  autoUpdater.on('update-downloaded', (info) => {
    downloaded = info.version;
    setUpdateState({ phase: 'downloaded', version: info.version, percent: 100 });
    win?.setProgressBar(-1);
    showStatus(lastStatus);
    if (!win?.isVisible()) notify({ iconType: 'info', title: `新版本 ${info.version} 已下载好`, content: '退出星临时会自动安装；也可以打开星临，在顶部点「现在重启并安装」。' });
  });
  setTimeout(() => void checkUpdate(false), 10_000);
  setInterval(() => void checkUpdate(false), 6 * 3600_000);
}

/** manual：用户点了「检查更新」，没有新版本或出错也要告诉他 */
async function checkUpdate(manual: boolean): Promise<void> {
  if (updateBusy) {
    if (manual) void ask({ type: 'info', title: NAME, message: '正在检查或下载更新，请稍等' });
    return;
  }
  updateBusy = true;
  try {
    const r = await autoUpdater.checkForUpdates();
    const next = r?.isUpdateAvailable ? r.updateInfo.version : null;
    if (!next) {
      if (manual) await ask({ type: 'info', title: NAME, message: '已经是最新版本', detail: `当前版本 ${app.getVersion()}` });
      return;
    }
    if (next === downloaded) {
      if (manual) await ask({ type: 'info', title: NAME, message: `新版本 ${next} 已经下载好了`, detail: '退出星临时会自动安装（Windows 会问一次是否允许更改，点「是」）；也可以在后台顶部点「现在重启并安装」。' });
      return;
    }
    // 后台检查：选了「以后再说」的同一个版本不再提
    if (!manual && next === declined) return;
    // 不弹系统对话框：在后台顶部问要不要下载（正在直播时后台先不说，等下播）。手动检查的把窗口叫出来
    nextVersion = { version: next, size: r?.updateInfo.files[0]?.size ?? 0 };
    setUpdateState({ phase: 'available', version: next, percent: 0, transferred: 0, total: nextVersion.size, speed: 0, error: null, source: null, note: null });
    if (manual) showWindow();
  } catch (e) {
    log('检查更新失败', e);
    win?.setProgressBar(-1);
    showStatus(lastStatus);
    if (manual) await ask({ type: 'error', title: NAME, message: '检查更新失败', detail: `${(e as Error).message}\n\n可以稍后再试，或者到 GitHub 发布页手动下载。` });
  } finally {
    updateBusy = false;
  }
}

/** 查到、还没下载的新版本 */
let nextVersion: { version: string; size: number } | null = null;

/** 后台顶部点了「下载」 */
async function startDownload(): Promise<void> {
  if (!nextVersion || updateBusy || updateState.phase === 'downloading') return;
  updateBusy = true;
  setUpdateState({ phase: 'downloading', version: nextVersion.version, percent: 0, transferred: 0, total: nextVersion.size, speed: 0, error: null, source: null, note: null });
  try {
    await downloadWithFallback();
  } catch (e) {
    log('下载新版本失败', e);
    win?.setProgressBar(-1);
    setUpdateState({ phase: 'error', error: (e as Error).message });
    showStatus(lastStatus);
  } finally {
    updateBusy = false;
  }
}

/**
 * 下载新版本：先直连 GitHub；连不上、断了、或者太慢（sources.ts）就换下一个地址。
 * 最后一个地址不再因为慢而换掉，慢也下完；全都失败时报最后一个错误
 */
async function downloadWithFallback(): Promise<void> {
  const sources = downloadSources(readState().updateMirror, githubDown);
  let note: string | null = null;
  let lastError: unknown = null;
  for (const [i, src] of sources.entries()) {
    mirror = src;
    const name = sourceName(src);
    const last = i === sources.length - 1;
    setUpdateState({ percent: 0, transferred: 0, speed: 0, source: name, note });
    log('[更新]', `从${name}下载`);
    const token = new CancellationToken();
    const watch = new SpeedWatch(Date.now());
    const onProgress = (p: ProgressInfo) => watch.progress(p.transferred, Date.now());
    autoUpdater.on('download-progress', onProgress);
    let slow = false;
    const timer = last
      ? null
      : setInterval(() => {
          if (!watch.tooSlow(Date.now())) return;
          slow = true;
          token.cancel();
        }, 1000);
    try {
      await autoUpdater.downloadUpdate(token);
      return;
    } catch (e) {
      lastError = e;
      log('[更新]', slow ? `${name}太慢，换下一个地址` : `${name}下载失败`, e);
      const next = sources[i + 1];
      if (next !== undefined) note = `${name}${slow ? '太慢' : '下载失败'}，已改用${sourceName(next)}`;
    } finally {
      if (timer) clearInterval(timer);
      autoUpdater.off('download-progress', onProgress);
      mirror = null;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------- 给后台页面用的功能（设置页的「桌面版」卡片） ----------

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
  handle('sf:info', () => ({ version: app.getVersion(), autoStart: autoStart(), canUpdate: app.isPackaged, dataDir: USER_DIR, updateMirror: readState().updateMirror ?? null }));
  // 自己填的备用下载地址：格式不对返回 false；空的为不用
  handle('sf:set-update-mirror', (v: string) => {
    const m = normalizeMirror(String(v ?? ''));
    if (m === undefined) return false;
    writeState({ updateMirror: m });
    log('备用下载地址', m ?? '（不用）');
    return true;
  });
  handle('sf:set-auto-start', (on: boolean) => {
    setAutoStart(Boolean(on));
    return autoStart();
  });
  handle('sf:check-update', () => void checkUpdate(true));
  handle('sf:update-state', () => updateState);
  handle('sf:fx-hint', () => fxHint);
  handle('sf:install-update', () => {
    if (updateState.phase === 'downloaded') void installNow();
  });
  // 后台顶部的新版本提示：下载 / 以后再说（以后再说的这个版本，定时检查时不再提）
  handle('sf:download-update', () => void startDownload());
  handle('sf:dismiss-update', () => {
    if (updateState.phase !== 'available') return;
    declined = updateState.version;
    setUpdateState({ phase: 'idle' });
  });
  // 后台换了亮色 / 暗色：标题栏、窗口底色跟着变，下次打开的启动画面也用这个
  handle('sf:set-theme', (t: string) => {
    const choice: ThemeChoice = t === 'light' || t === 'dark' ? t : 'system';
    nativeTheme.themeSource = choice;
    win?.setBackgroundColor(bgColor());
    if (readState().theme !== choice) writeState({ theme: choice });
  });
  handle('sf:reload-hotkeys', () => registerHotkeys(true));
  handle('sf:pause-hotkeys', () => pauseHotkeys());
  // 点歌的本地歌库：选一个放音乐的文件夹，返回完整路径（取消时为 null）
  handle('sf:pick-folder', async () => {
    const opts: Electron.OpenDialogOptions = { title: '选择放音乐的文件夹', properties: ['openDirectory'] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('sf:open-data', () => void shell.openPath(USER_DIR));
  handle('sf:open-logs', () => void shell.openPath(LOG_DIR));
}
