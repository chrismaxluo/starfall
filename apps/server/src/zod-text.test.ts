import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { issueText } from './zod-text.ts';

const first = (schema: z.ZodType, v: unknown) => issueText(schema.safeParse(v).error!.issues[0]!);

describe('校验报错翻成中文', () => {
  it('用界面上的叫法说清楚哪里不对', () => {
    expect(first(z.object({ keywords: z.array(z.string()).max(20) }), { keywords: Array(21).fill('a') })).toBe('关键词最多 20 个');
    expect(first(z.object({ cooldownMin: z.number().max(1440) }), { cooldownMin: 2000 })).toBe('多久内只播一次不能超过 1440');
    expect(first(z.object({ cooldownMin: z.number() }), { cooldownMin: '' })).toBe('多久内只播一次要填一个数字');
    expect(first(z.object({ name: z.string().min(1) }), { name: '' })).toBe('名称不能为空');
  });
  it('礼物价值换成电池', () => {
    expect(first(z.object({ fromGold: z.number().max(1_000_000) }), { fromGold: 2_000_000 })).toBe('礼物价值不能超过 10000 电池');
  });
  it('自己写的中文说明直接用', () => {
    expect(first(z.object({ next: z.string().min(8, '新密码至少 8 位') }), { next: '1' })).toBe('新密码至少 8 位');
  });
});
