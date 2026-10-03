// 按 Esc 关闭弹出框、小窗：只关最上面（最后打开）的那一个；没有登记的时候交给页面自己处理（素材设置、预览小窗等）
import { onBeforeUnmount, onMounted } from 'vue';

const stack: Array<() => void> = [];
addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stack[stack.length - 1]!();
  },
  true,
);

/** 登记一个按 Esc 要执行的关闭动作，返回取消登记的函数 */
export function pushEsc(fn: () => void): () => void {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 组件显示期间按 Esc 关闭（弹窗类组件：显示就是打开） */
export function useEsc(fn: () => void): void {
  let off: (() => void) | null = null;
  onMounted(() => (off = pushEsc(fn)));
  onBeforeUnmount(() => off?.());
}
