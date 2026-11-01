// 亮色 / 暗色：默认跟随系统；手动切换时从按钮位置圆形扩散（F-UI-08）
import { desktop } from './desktop.ts';

/** 电脑版：窗口的标题栏跟着后台的亮色 / 暗色（没手动选过时跟随系统） */
export function syncDesktopTheme(): void {
  let t: string | null = null;
  try {
    t = localStorage.getItem('sf-theme');
  } catch {
    /* 隐私模式 */
  }
  void desktop?.setTheme?.(t === 'light' || t === 'dark' ? t : 'system')?.catch(() => undefined);
}

export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function setTheme(t: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('sf-theme', t);
  } catch {
    /* 隐私模式 */
  }
  void desktop?.setTheme?.(t)?.catch(() => undefined);
}

export function toggleTheme(x: number, y: number): void {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return setTheme(next);
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = doc.startViewTransition(() => setTheme(next));
  void vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}
