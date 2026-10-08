// 桌面版窗口给后台页面开放的功能（apps/desktop/src/preload.ts）。用浏览器打开后台时是 undefined
export interface DesktopInfo {
  version: string;
  autoStart: boolean;
  canUpdate: boolean;
  dataDir: string;
}
export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  setAutoStart(on: boolean): Promise<boolean>;
  checkUpdate(): Promise<void>;
  /** 重新注册全局快捷键；返回被别的软件占用的 */
  reloadHotkeys(): Promise<{ failed: string[] }>;
  /** 先注销全局快捷键（编辑快捷播放按钮时用） */
  pauseHotkeys(): Promise<void>;
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
