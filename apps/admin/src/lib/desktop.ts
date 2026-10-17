// 桌面版窗口给后台页面开放的功能（apps/desktop/src/preload.ts）。用浏览器打开后台时是 undefined
export interface DesktopInfo {
  version: string;
  autoStart: boolean;
  canUpdate: boolean;
  dataDir: string;
  /** 自己填的备用下载地址（加速站），没填为 null */
  updateMirror: string | null;
}
/** 下载新版本的进度（apps/desktop/src/main.ts 的 UpdateState） */
export interface UpdateState {
  phase: 'idle' | 'downloading' | 'downloaded' | 'error';
  version: string | null;
  percent: number;
  transferred: number;
  total: number;
  /** 每秒下载多少字节 */
  speed: number;
  error: string | null;
  /** 正在从哪里下载（GitHub 直连 / 备用地址 xxx） */
  source: string | null;
  /** 换过下载地址时说明原因 */
  note: string | null;
}
/** 特效页没连上时的提醒（apps/desktop/src/main.ts 的 FxHint） */
export interface FxHint {
  /** 开着、但特效页一直没连上的直播软件（直播姬、OBS）；没有为 null */
  app: string | null;
  /** 这次用的端口，和平时的端口（17520）：不一样说明平时的端口被占用了 */
  port: number;
  home: number;
  /** 特效页没连上时怎么办 */
  fix: string;
}
export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  setAutoStart(on: boolean): Promise<boolean>;
  checkUpdate(): Promise<void>;
  /** 保存备用下载地址（空的为不用）；格式不对返回 false */
  setUpdateMirror(v: string): Promise<boolean>;
  updateState(): Promise<UpdateState>;
  /** 进度有变化时回调；返回取消监听的函数 */
  onUpdateState(cb: (s: UpdateState) => void): () => void;
  /** 新版本下载好后：现在重启并安装 */
  installUpdate(): Promise<void>;
  /** 特效页没连上时的提醒：先取一次现在的，之后有变化时回调（返回取消监听的函数）；旧版桌面版没有 */
  fxHint?(): Promise<FxHint>;
  onFxHint?(cb: (h: FxHint) => void): () => void;
  /** 重新注册全局快捷键；返回被别的软件占用的 */
  reloadHotkeys(): Promise<{ failed: string[] }>;
  /** 先注销全局快捷键（编辑快捷播放按钮时用） */
  pauseHotkeys(): Promise<void>;
  /** 选一个文件夹（点歌的本地歌库），取消时为 null；旧版桌面版没有 */
  pickFolder?(): Promise<string | null>;
  openDataDir(): Promise<void>;
  openLogs(): Promise<void>;
}
export const desktop = (window as unknown as { starfallDesktop?: DesktopBridge }).starfallDesktop;

/** 重新注册全局快捷键，被占用的提示出来 */
export async function reloadHotkeys(): Promise<string[]> {
  if (!desktop) return [];
  const r = await desktop.reloadHotkeys().catch(() => ({ failed: [] as string[] }));
  return r.failed;
}
