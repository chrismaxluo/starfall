import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/server', 'apps/overlay', 'apps/admin'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/server/src/**/*.ts', 'apps/overlay/src/**/*.ts', 'apps/admin/src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/testing.ts'],
    },
  },
});
