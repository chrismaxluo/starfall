// 动效（产品体验第一轮）：只在操作时动，0.2 秒左右，从哪来回哪去，只动位置和透明度；
// 系统设置了「减少动画」、窗口藏起来（电脑版缩到托盘）时不动。样式在 styles/motion.css
import { onActivated, onDeactivated, onMounted, onBeforeUnmount, ref } from 'vue';

const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
/** 系统设置了「减少动画」 */
export const reduced = (): boolean => reducedMq.matches;

// 最近一次点击、按键：数据自己变了（例如开播后「本场 / 今天」自动切换）不播过渡，只有操作引起的才播
let lastInput = -Infinity;
for (const t of ['pointerdown', 'keydown'] as const) addEventListener(t, () => (lastInput = performance.now()), { capture: true, passive: true });
const acted = () => performance.now() - lastInput < 1500;

/** 现在可以播过渡：窗口看得见、没设「减少动画」 */
export const canAnimate = (): boolean => !reducedMq.matches && document.visibilityState === 'visible';
/** 由操作引起、可以播过渡 */
export const canAnimateAction = (): boolean => canAnimate() && acted();

const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';

// ---------- 选中的底色、下划线滑过去：分段按钮、标签页、侧栏 ----------
// 不用改每个地方的写法：看着 aria-pressed / aria-selected / aria-current 的变化，
// 从旧的那一项到新的那一项放一个「替身」滑过去，滑到了再交还给新的那一项自己显示
const SLIDE_BOX = '.seg, .ptabs, .rtabs, .side';
const LINE_BOX = '.ptabs, .rtabs';
const on = (v: string | null) => v === 'true' || v === 'page';
const sliding = new WeakMap<Element, () => void>();

function slide(box: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  sliding.get(box)?.();
  const line = box.matches(LINE_BOX);
  const b = box.getBoundingClientRect();
  const ox = box.scrollLeft - b.left - box.clientLeft;
  const oy = box.scrollTop - b.top - box.clientTop;
  const g = document.createElement('span');
  g.className = 'mv-ghost';
  g.setAttribute('aria-hidden', 'true');
  let geo: (r: DOMRect) => Keyframe;
  if (line) {
    const a = getComputedStyle(to, '::after');
    const inset = parseFloat(a.left) || 8;
    const h = parseFloat(a.height) || 2;
    Object.assign(g.style, { background: a.backgroundColor, borderRadius: a.borderRadius });
    geo = (r) => ({ left: `${r.left + ox + inset}px`, top: `${r.bottom + oy + 1 - h}px`, width: `${Math.max(0, r.width - inset * 2)}px`, height: `${h}px` });
  } else {
    const s = getComputedStyle(to);
    Object.assign(g.style, { background: s.backgroundColor, boxShadow: s.boxShadow, borderRadius: s.borderRadius });
    geo = (r) => ({ left: `${r.left + ox}px`, top: `${r.top + oy}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  const f = from.getBoundingClientRect();
  const t = to.getBoundingClientRect();
  box.prepend(g);
  to.classList.add('mv-hold');
  const anim = g.animate([geo(f), geo(t)], { duration: line ? 260 : 240, easing: EASE_OUT, fill: 'both' });
  const done = () => {
    sliding.delete(box);
    anim.cancel();
    g.remove();
    to.classList.remove('mv-hold');
  };
  sliding.set(box, done);
  anim.onfinish = done;
}

function watchSlides(): void {
  const mo = new MutationObserver((recs) => {
    if (!canAnimateAction()) return;
    const boxes = new Map<HTMLElement, { from?: HTMLElement; to?: HTMLElement }>();
    for (const r of recs) {
      const el = r.target;
      if (!(el instanceof HTMLElement) || !r.attributeName) continue;
      const box = el.parentElement?.closest<HTMLElement>(SLIDE_BOX);
      if (!box) continue;
      const was = on(r.oldValue);
      const now = on(el.getAttribute(r.attributeName));
      if (was === now) continue;
      const x = boxes.get(box) ?? {};
      if (was) x.from = el;
      else x.to = el;
      boxes.set(box, x);
    }
    for (const [box, { from, to }] of boxes) {
      // 只在看得见、大小正常的两项之间滑（藏起来的、刚换掉的不算）
      if (from?.isConnected && to?.isConnected && from.offsetWidth && to.offsetWidth) slide(box, from, to);
    }
  });
  mo.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['aria-pressed', 'aria-selected', 'aria-current'] });
}

// ---------- 弹出来的东西：关的时候也有过渡 ----------
// 弹窗、抽屉、菜单关掉时（组件已经拿掉了），把拿掉的那块放回原处播一段收回去的动画再真正拿掉。
// 打开时的动画本来就有（styles/app.css 的 pop、edIn、drawerIn…）
const CLOSING = '.scrim, .drawer-scrim, .drawer, .ed-scrim, .editor, .wiz, .qdialog, .dlg, .pv-scrim, .menu, .rmenu, .pickpop, .cdpop, .datepop, .sheet';
const CLOSE_MS = 200;
const ghosts = new WeakSet<Node>();

function watchClosing(root: Node): void {
  const mo = new MutationObserver((recs) => {
    if (!canAnimate()) return;
    for (const r of recs) {
      for (const n of r.removedNodes) {
        // 被挪了位置（还在页面上）、自己放回去的不管
        if (!(n instanceof HTMLElement) || n.isConnected || ghosts.has(n) || !n.matches(CLOSING)) continue;
        ghosts.add(n);
        n.classList.add('mv-out');
        n.setAttribute('aria-hidden', 'true');
        n.removeAttribute('role');
        (r.target as HTMLElement).append(n);
        setTimeout(() => n.remove(), CLOSE_MS);
      }
    }
  });
  mo.observe(root, { childList: true });
}

export function installMotion(): void {
  watchSlides();
  watchClosing(document.body);
  const app = document.getElementById('app');
  if (app) watchClosing(app);
}

// ---------- 列表：删掉的那一行收起来，下面的滑上去；撤销时再展开 ----------
// 配合 <TransitionGroup name="lst">：离开的那一项先固定在原来的位置（不占地方），其他的滑过去
export function pinLeaving(el: Element): void {
  const h = el as HTMLElement;
  Object.assign(h.style, { left: `${h.offsetLeft}px`, top: `${h.offsetTop}px`, width: `${h.offsetWidth}px`, height: `${h.offsetHeight}px` });
}

/** 列表现在适不适合播进出的过渡：页面看得见、刚才有操作（筛选、换页时整批换掉的不播） */
export function useListMotion() {
  const active = ref(true);
  onActivated(() => (active.value = true));
  onDeactivated(() => (active.value = false));
  return () => (active.value && canAnimate() ? 'lst' : 'lst-off');
}

/** 组件显示期间每隔 ms 执行一次；页面缓存起来（换到别的页）时停下 */
export function useTick(fn: () => void, ms: number): void {
  let t: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (!t) t = setInterval(fn, ms);
  };
  const stop = () => {
    if (t) clearInterval(t);
    t = null;
  };
  onMounted(start);
  onActivated(() => (fn(), start()));
  onDeactivated(stop);
  onBeforeUnmount(stop);
}
