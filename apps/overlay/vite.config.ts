import { defineConfig } from 'vite';

export default defineConfig({
  // 特效页挂在服务的 /overlay/ 路径下
  base: '/overlay/',
  build: { outDir: 'dist', emptyOutDir: true },
});
