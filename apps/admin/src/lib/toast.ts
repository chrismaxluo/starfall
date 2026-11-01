import { reactive } from 'vue';

export interface ToastAction {
  label: string;
  run: () => void | Promise<unknown>;
}
export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
  out: boolean;
  /** 提示条上的按钮（例如「撤销」「去用上它」），点了就收起提示 */
  action?: ToastAction | undefined;
}

export const toasts = reactive<Toast[]>([]);
let seq = 0;

// 在原地说「已保存」：开关、草稿条点了以后，接下来那条成功提示不弹在右下角，交给它们自己显示（右下角只留给重要的事）
let quiet: { fn: (text: string) => void; match?: ((text: string) => boolean) | undefined; until: number } | null = null;
/** 接下来 ms 毫秒内的第一条成功提示交给 fn 显示（match 不传时任何成功提示都算）；出错提示照常弹出 */
export function quietNext(fn: (text: string) => void, match?: (text: string) => boolean, ms = 5000): void {
  quiet = { fn, match, until: Date.now() + ms };
}
// 又点了别的、按了键：之后的提示和刚才那一下无关，照常弹出
// （单元测试里没有浏览器窗口，不挂）
const inBrowser = typeof window !== 'undefined';
if (inBrowser) for (const t of ['pointerdown', 'keydown'] as const) addEventListener(t, () => (quiet = null), { capture: true, passive: true });

export function toast(text: string, kind: Toast['kind'] = 'ok', ms = kind === 'err' ? 5000 : 2600, action?: ToastAction): void {
  if (quiet && Date.now() < quiet.until && kind !== 'info' && !action) {
    const q = quiet;
    quiet = null;
    if (kind === 'ok' && (!q.match || q.match(text))) return q.fn(text);
  }
  // 一样的提示连着出现时只留一条（例如连着勾了几个选项）
  const same = toasts.find((y) => y.text === text && !y.out && !y.action);
  if (same && !action) dismiss(same.id);
  const t: Toast = { id: ++seq, text, kind, out: false, action };
  toasts.push(t);
  if (toasts.length > 4) toasts.shift();
  setTimeout(() => dismiss(t.id), action ? Math.max(ms, 8000) : ms);
}

export function dismiss(id: number): void {
  const x = toasts.find((y) => y.id === id);
  if (!x || x.out) return;
  x.out = true;
  setTimeout(() => {
    const i = toasts.findIndex((y) => y.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, 260);
}

/** 能撤销的时间 */
export const UNDO_MS = 8000;

/** 带「撤销」的提示：删错、改错时 8 秒内可以恢复 */
export function undoable(text: string, undo: () => Promise<unknown>): void {
  toast(text, 'ok', UNDO_MS, { label: '撤销', run: undo });
}

// 还没真正删掉的（撤销时间还没过）：关掉、刷新页面时马上删
const pendingDeletes = new Set<() => void>();
if (inBrowser)
  addEventListener('pagehide', () => {
    for (const f of [...pendingDeletes]) f();
  });

/**
 * 删除后找不回来的东西（素材、音效、本地歌曲）：马上从界面上拿掉，右下角 8 秒内可以「撤销」，过了才真正删除。
 * hide / restore 只改界面；commit 真正删除（失败时放回来并提示）；url 是关掉页面时用来删除的地址（DELETE）
 */
export function deleteLater(text: string, o: { hide: () => void; restore: () => void; commit: () => Promise<unknown>; url: string }): void {
  o.hide();
  let settled = false;
  const finish = () => {
    settled = true;
    clearTimeout(timer);
    pendingDeletes.delete(flush);
  };
  const flush = () => {
    if (settled) return;
    finish();
    void fetch(o.url, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  };
  const timer = setTimeout(() => {
    if (settled) return;
    finish();
    void o.commit().catch((e: unknown) => {
      o.restore();
      toast(e instanceof Error ? e.message : String(e), 'err');
    });
  }, UNDO_MS + 300);
  pendingDeletes.add(flush);
  toast(text, 'ok', UNDO_MS, {
    label: '撤销',
    run: () => {
      if (settled) return;
      finish();
      o.restore();
    },
  });
}

export async function runAction(t: Toast): Promise<void> {
  const a = t.action;
  dismiss(t.id);
  if (a) await attempt(async () => a.run());
}

/** 执行一个操作，出错时弹出错误提示；返回是否成功 */
export async function attempt<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (okText) toast(okText);
    return r;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
    return undefined;
  }
}
