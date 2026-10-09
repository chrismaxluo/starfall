// 给星临后台页面开放的桌面版功能（设置页的「桌面版」卡片、快捷播放页、关于页用）。只开放这几个，页面拿不到其他系统能力
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('starfallDesktop', {
  info: () => ipcRenderer.invoke('sf:info'),
  setAutoStart: (on: boolean) => ipcRenderer.invoke('sf:set-auto-start', on),
  checkUpdate: () => ipcRenderer.invoke('sf:check-update'),
  /** 下载新版本的进度（窗口顶部的进度条用）：先取一次现在的，之后有变化时回调；返回取消监听的函数 */
  updateState: () => ipcRenderer.invoke('sf:update-state'),
  onUpdateState: (cb: (s: unknown) => void) => {
    const l = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('sf:update-state', l);
    return () => void ipcRenderer.removeListener('sf:update-state', l);
  },
  /** 新版本下载好后：现在重启并安装 */
  installUpdate: () => ipcRenderer.invoke('sf:install-update'),
  /** 素材快捷播放的按钮保存后，重新注册全局快捷键；返回被别的软件占用的 */
  reloadHotkeys: () => ipcRenderer.invoke('sf:reload-hotkeys'),
  /** 编辑快捷播放按钮时先注销全局快捷键（录快捷键时不会被系统拦走） */
  pauseHotkeys: () => ipcRenderer.invoke('sf:pause-hotkeys'),
  openDataDir: () => ipcRenderer.invoke('sf:open-data'),
  openLogs: () => ipcRenderer.invoke('sf:open-logs'),
});
