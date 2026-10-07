// 给星临后台页面开放的电脑版功能（设置页的「电脑版」卡片、快捷播放页、关于页用）。只开放这几个，页面拿不到其他系统能力
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('starfallDesktop', {
  info: () => ipcRenderer.invoke('sf:info'),
  setAutoStart: (on: boolean) => ipcRenderer.invoke('sf:set-auto-start', on),
  checkUpdate: () => ipcRenderer.invoke('sf:check-update'),
  /** 素材快捷播放的按钮保存后，重新注册全局快捷键；返回被别的软件占用的 */
  reloadHotkeys: () => ipcRenderer.invoke('sf:reload-hotkeys'),
  openDataDir: () => ipcRenderer.invoke('sf:open-data'),
  openLogs: () => ipcRenderer.invoke('sf:open-logs'),
});
