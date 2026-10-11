// 提前算好混合色：直播软件的旧内核（Chrome 111 以前）不认 CSS 的 color-mix()，整条样式会被丢掉（底条、描边全没了）

type Rgba = [number, number, number, number];

function parse(c: string): Rgba {
  if (c === 'transparent') return [0, 0, 0, 0];
  const m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const [r, g, b, a = 1] = m[1]!.split(',').map(Number);
    return [r!, g!, b!, a];
  }
  const hex = c.replace('#', '');
  const n = parseInt(hex.length === 3 ? [...hex].map((x) => x + x).join('') : hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
}

/** 和 CSS 的 color-mix(in srgb, a p%, b) 一样：按透明度预乘后混合 */
export function mix(a: string, p: number, b = 'transparent'): string {
  const x = parse(a);
  const y = parse(b);
  const w = p / 100;
  const alpha = x[3] * w + y[3] * (1 - w);
  if (alpha === 0) return 'rgba(0, 0, 0, 0)';
  const ch = (i: number) => Math.round((x[i]! * x[3] * w + y[i]! * y[3] * (1 - w)) / alpha);
  return `rgba(${ch(0)}, ${ch(1)}, ${ch(2)}, ${+alpha.toFixed(4)})`;
}
