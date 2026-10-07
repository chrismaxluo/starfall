// 素材快捷播放：点按钮或按快捷键，马上在直播画面上播放。
// 网页里的快捷键只在「总览」「素材快捷播放」页面是当前窗口时有用；在游戏、直播软件里按要用电脑版的全局快捷键。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { errMsg, post } from './api.ts';
import { effectById, state } from './store.ts';
import { toast } from './toast.ts';
import type { QuickButton } from './types.ts';

/** 按钮上显示的名字：没起名字时用素材名 */
export const quickName = (b: Pick<QuickButton, 'label' | 'effectId'>) => b.label || effectById(b.effectId)?.name || '素材已删除';

/** 按键 → 快捷键：数字键、小键盘数字、字母；用 code 判断，不受输入法、大小写影响 */
export function keyOf(e: Pick<KeyboardEvent, 'code'>): string | null {
  const m = /^(?:Digit|Numpad)([0-9])$|^Key([A-Z])$/.exec(e.code);
  return m ? (m[1] ?? m[2]!) : null;
}

/** 刚按下的按钮（闪一下） */
export const pressed = ref<number | null>(null);
let pressTimer: ReturnType<typeof setTimeout> | null = null;

export async function playQuick(b: QuickButton): Promise<void> {
  pressed.value = b.id;
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = setTimeout(() => (pressed.value = null), 600);
  try {
    await post(`/api/quickplay/play/${b.id}`);
  } catch (e) {
    toast(errMsg(e), 'err');
  }
}

/** 正在打字、开着弹窗或选择列表时不响应快捷键 */
function busy(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return true;
  return Boolean(document.querySelector('[aria-modal="true"], .pickpop'));
}

/** 在页面里挂上快捷键；active 返回假时（例如正在编辑按钮）不响应 */
export function useQuickHotkeys(active: () => boolean = () => true): void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !active() || busy(e)) return;
    const k = keyOf(e);
    const b = k ? state.quick.find((x) => x.hotkey === k) : undefined;
    if (!b) return;
    e.preventDefault();
    void playQuick(b);
  };
  onMounted(() => addEventListener('keydown', onKey));
  onBeforeUnmount(() => removeEventListener('keydown', onKey));
}
