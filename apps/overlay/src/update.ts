// 自动更新：服务端的特效页更新了，旧页面等空闲时自动刷新，直播软件里不用手动刷新浏览器源。
import { OVERLAY_BUILD_RE } from '@starfall/shared/overlay';

/** 连续这么久没有特效在播，才算空闲 */
export const IDLE_MS = 2000;
/** 刷新过还是旧版本（被缓存了）时，这么久内不再为同一个版本刷新，免得反复刷 */
export const RETRY_MS = 10 * 60_000;
const KEY = 'sf-reload';

/** 这个页面的版本（入口脚本名）；开发模式下没有，不自动更新 */
export function pageBuild(doc: Document = document): string | null {
  for (const s of Array.from(doc.scripts)) {
    const m = s.src.match(OVERLAY_BUILD_RE);
    if (m) return m[0];
  }
  return null;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/**
 * 返回"收到服务端版本"的处理函数：版本不一样时，每半秒看一次，连续 IDLE_MS 没有特效在播就刷新。
 * busy：现在有没有特效在播；reload：刷新页面；store：记住刚为哪个版本刷新过（sessionStorage）。
 */
export function autoUpdate(mine: string | null, busy: () => boolean, reload: () => void = () => location.reload(), store: Store | null = safeSession(), now: () => number = Date.now): (latest: string | null) => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  return (latest) => {
    if (!mine || !latest || latest === mine || timer) return;
    try {
      const last = JSON.parse(store?.getItem(KEY) ?? 'null') as { build?: string; at?: number } | null;
      if (last?.build === latest && now() - (last.at ?? 0) < RETRY_MS) return;
    } catch {
      /* 读不到就照常刷新 */
    }
    let quietSince = now();
    timer = setInterval(() => {
      if (busy()) return void (quietSince = now());
      if (now() - quietSince < IDLE_MS) return;
      clearInterval(timer!);
      try {
        store?.setItem(KEY, JSON.stringify({ build: latest, at: now() }));
      } catch {
        /* 存不了也刷新 */
      }
      reload();
    }, 500);
  };
}

function safeSession(): Store | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}
