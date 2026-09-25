import { describe, expect, it } from 'vitest';
import { APP_NAME } from './index.ts';

describe('core', () => {
  it('能引用 shared 包', () => {
    expect(APP_NAME).toBe('星临');
  });
});
