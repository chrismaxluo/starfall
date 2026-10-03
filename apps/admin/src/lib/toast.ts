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

export function toast(text: string, kind: Toast['kind'] = 'ok', ms = kind === 'err' ? 5000 : 2600, action?: ToastAction): void {
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

/** 带「撤销」的提示：删错、改错时 8 秒内可以恢复 */
export function undoable(text: string, undo: () => Promise<unknown>): void {
  toast(text, 'ok', 8000, { label: '撤销', run: undo });
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
