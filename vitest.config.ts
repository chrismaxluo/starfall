import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/server', 'apps/overlay'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/server/src/**/*.ts', 'apps/overlay/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/testing.ts'],
    },
  },
});
