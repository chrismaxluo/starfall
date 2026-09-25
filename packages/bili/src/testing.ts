// 测试辅助：读取 fixtures/bili 下的脱敏样本
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../../../fixtures/bili');

export function fixture(name: string): { cmd?: string; [k: string]: unknown } {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
}

export const FIXTURE_ANCHOR = 20000;
