import { defineConfig } from 'vite';

export default defineConfig({
  // 特效页挂在服务的 /overlay/ 路径下
  base: '/overlay/',
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome95' },
  // 开发时（pnpm --filter @starfall/overlay dev）把接口和文件转发给本机的星临服务
  server: {
    port: 5174,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:17520', ws: true },
      '/files': 'http://127.0.0.1:17520',
    },
  },
});
