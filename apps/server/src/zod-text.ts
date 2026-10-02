// 把 zod 的校验报错翻成主播看得懂的中文（字段名换成界面上的叫法）。前端会先拦常见的情况，这里兜底。
import type { z } from 'zod';

/** 字段 → 界面上的叫法 */
const FIELD: Record<string, string> = {
  keywords: '关键词',
  cooldownMin: '多久内只播一次',
  userCdMin: '同一个人多久内只播一次',
  globalCdSec: '所有人合计多久内只播一次',
  comboSec: '连击合并时间',
  giftComboSec: '连击合并时间',
  name: '名称',
  effectId: '特效',
  openEffectId: '开通时的特效',
  renewEffectId: '续费时的特效',
  soundAssetId: '音效',
  volume: '音量',
  durationMs: '时长',
  fadeInMs: '渐入时间',
  fadeOutMs: '渐出时间',
  featherPct: '羽化宽度',
  sizePct: '大小',
  offsetX: '左右挪动',
  offsetY: '上下挪动',
  fromLevel: '粉丝牌等级',
  fanMin: '粉丝牌等级',
  honorMin: '荣耀等级',
  fromGold: '礼物价值',
  unitPrice: '礼物单价',
  count: '数量',
  months: '月数',
  uid: 'UID',
  uids: '指定观众',
  guards: '大航海',
  bands: '分段',
  specific: '指定礼物',
  exclusives: '专属用户',
  queueMax: '排队上限',
  retentionDays: '保留天数',
  password: '密码',
  text: '弹幕内容',
  giftName: '礼物名',
  q: '搜索内容',
};

function field(path: PropertyKey[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const k = path[i];
    if (typeof k === 'string' && FIELD[k]) return FIELD[k];
  }
  return '填的内容';
}
const isGold = (path: PropertyKey[]) => path.some((k) => k === 'fromGold' || k === 'unitPrice');
/** 金瓜子 → 电池（界面上礼物价值都用电池） */
const num = (path: PropertyKey[], v: number | bigint) => (isGold(path) ? `${Number(v) / 100} 电池` : String(v));

/** 写规则时自己给的说明都是中文（zod 自带的是英文），有就直接用 */
const hasChinese = (t: string) => /[\u4e00-\u9fff]/.test(t);

export function issueText(issue: z.core.$ZodIssue): string {
  if (hasChinese(issue.message)) return issue.message;
  const f = field(issue.path);
  switch (issue.code) {
    case 'too_big':
      if (issue.origin === 'array' || issue.origin === 'set') return `${f}最多 ${issue.maximum} 个`;
      if (issue.origin === 'string') return `${f}最多 ${issue.maximum} 个字`;
      return `${f}不能超过 ${num(issue.path, issue.maximum as number)}`;
    case 'too_small':
      if (issue.origin === 'array' || issue.origin === 'set') return Number(issue.minimum) <= 1 ? `${f}至少要有一个` : `${f}至少要有 ${issue.minimum} 个`;
      if (issue.origin === 'string') return Number(issue.minimum) <= 1 ? `${f}不能为空` : `${f}至少 ${issue.minimum} 个字`;
      return `${f}不能小于 ${num(issue.path, issue.minimum as number)}`;
    case 'invalid_type':
      if (issue.expected === 'number' || issue.expected === 'int') return `${f}要填一个数字`;
      if (issue.input === undefined) return `缺少${f}`;
      return `${f}的格式不对`;
    case 'not_multiple_of':
      return `${f}的数值不对`;
    case 'invalid_value':
    case 'invalid_union':
      return `${f}的选项不对`;
    case 'invalid_format':
      return `${f}的格式不对`;
    case 'unrecognized_keys':
      return '有不认识的设置项，请刷新页面后再试';
    default:
      return `${f}不正确`;
  }
}
