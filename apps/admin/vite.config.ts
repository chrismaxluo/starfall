import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome105' },
  // 开发时（pnpm --filter @starfall/admin dev）把接口、实时连接、特效页、文件转发给本机的星临服务
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:17520',
      '/ws': { target: 'ws://127.0.0.1:17520', ws: true },
      '/overlay': 'http://127.0.0.1:17520',
      '/files': 'http://127.0.0.1:17520',
    },
  },
});
