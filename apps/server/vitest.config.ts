import { defineProject } from 'vitest/config';

// 服务端测试包含密码哈希、ffprobe 识别文件，在 2 核的开发服务器上并行运行时会比较慢
export default defineProject({
  test: { name: '@starfall/server', testTimeout: 20_000 },
});
