// 建 DOM 的小工具。观众昵称、弹幕都来自观众，一律用 textContent 写入，不拼 HTML。
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; style?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.style) for (const [k, v] of Object.entries(props.style)) el.style.setProperty(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';

/** 引用 index.html 里定义好的图标 */
export function icon(id: string, cls?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export function svgPath(viewBox: string, d: string, cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', cls);
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}
