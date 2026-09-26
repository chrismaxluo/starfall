// 欢迎语（需求 F-AS-09 ~ 10）：按事件挑选文案，随机选一句，替换变量。
// 这里只生成纯文本；特效页负责把它当作文本显示（不作为 HTML），避免观众昵称里的特殊字符造成问题。
import { GUARD_NAMES, goldToYuan } from '@starfall/shared';
import type { EffectTexts, TriggerKind, Viewer } from '@starfall/shared';

export interface TextVars {
  viewer: Viewer;
  /** 弹幕内容 */
  text?: string;
  gift?: string;
  count?: number;
  /** 礼物价值，单位：金瓜子 */
  valueGold?: number;
  months?: number;
  /** 上舰：开通还是续费 */
  op?: 'open' | 'renew';
  /** 上舰事件里的新等级；不填时用观众当前的大航海等级 */
  guardLevel?: 1 | 2 | 3;
}

/** 取某个事件要用的文案池：该事件写了就用它，否则用通用（enter） */
export function textPool(texts: EffectTexts, kind: TriggerKind): string[] {
  const own = kind === 'enter' ? undefined : texts[kind];
  const pool = own && own.some((t) => t.trim()) ? own : texts.enter;
  return pool.filter((t) => t.trim());
}

/** 从文案池里随机选一句；rng 可注入，便于测试 */
export function pickText(texts: EffectTexts, kind: TriggerKind, rng: () => number = Math.random): string {
  const pool = textPool(texts, kind);
  if (pool.length === 0) return '{name}';
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
}

export function fillText(template: string, v: TextVars): string {
  const guard = v.guardLevel ?? v.viewer.guard;
  const map: Record<string, string> = {
    name: v.viewer.name,
    guard: guard ? GUARD_NAMES[guard] : '',
    medal: v.viewer.medal?.name ?? '',
    level: v.viewer.medal ? String(v.viewer.medal.level) : '',
    text: v.text ?? '',
    gift: v.gift ?? '',
    count: v.count !== undefined ? String(v.count) : '',
    value: v.valueGold !== undefined ? `${formatYuan(goldToYuan(v.valueGold))} 元` : '',
    months: v.months !== undefined ? String(v.months) : '',
    op: v.op === 'renew' ? '续费' : v.op === 'open' ? '开通' : '',
    act: v.op === 'renew' ? '续费' : v.op === 'open' ? '上舰' : '',
  };
  return template
    .replace(/\{(\w+)\}/g, (all, key: string) => (key in map ? map[key]! : all))
    .replace(/ {2,}/g, ' ')
    .trim();
}

function formatYuan(y: number): string {
  return y >= 100 ? String(Math.round(y)) : String(Math.round(y * 10) / 10);
}
