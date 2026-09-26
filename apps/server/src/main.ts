// 服务创建的所有文件（数据库、素材、日志）只有运行账号能读写
process.umask(0o077);

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createContext, importSpikeAccount, startBackground } from './context.ts';

// 兜底：漏掉的 Promise 错误只写日志、服务继续运行；真正没接住的异常写日志后退出，由 systemd 重启
process.on('unhandledRejection', (e) => console.error('[星临] 未处理的异步错误：', e));
process.on('uncaughtException', (e) => {
  console.error('[星临] 未处理的异常，服务将重启：', e);
  process.exit(1);
});

const config = loadConfig();
const ctx = createContext(config);
const app = await buildApp(ctx, { logger: true });

if (ctx.initialPassword) {
  // 密码只写进文件（权限 600），不写日志：能读系统日志的人不一定该知道密码
  app.log.warn(`首次启动：已生成管理后台初始密码，保存在 ${config.dataDir}/initial-password.txt，登录后请修改`);
}

if (await importSpikeAccount(ctx)) app.log.info('已把技术验证时保存的 B 站登录信息加密导入，并删除了明文文件');
const stopBackground = await startBackground(ctx);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`收到 ${signal}，正在退出`);
    stopBackground();
    void app.close().then(() => {
      ctx.db.$client.close();
      process.exit(0);
    });
  });
}

await app.listen({ port: config.port, host: config.host });
