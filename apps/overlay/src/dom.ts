// 建 DOM 的小工具。观众昵称、弹幕都来自观众，一律用 textContent 写入，不拼 HTML。
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; style?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.style) for (const [k, v] of Object.entries(props.style)) el.style.setProperty(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
