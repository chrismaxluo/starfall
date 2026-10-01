import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

// 字体只打包 woff2：fontsource 的样式里每个字体都同时写了 woff2 和 woff 两份，
// 直播姬（Chrome 95）、OBS、浏览器和电脑版都认 woff2，woff 那份从来用不上，去掉后少一半字体文件
const woff2Only: Plugin = {
  name: 'woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/@fontsource\/[^?]+\.css($|\?)/.test(id)) return;
    return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '');
  },
};

export default defineConfig({
  plugins: [woff2Only, vue()],
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
