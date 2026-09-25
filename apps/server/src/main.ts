import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';

const config = loadConfig();
const ctx = createContext(config);
const app = await buildApp(ctx, { logger: true });

if (ctx.initialPassword) {
  app.log.warn(`首次启动：已生成管理后台初始密码 ${ctx.initialPassword}（也保存在 ${config.dataDir}/initial-password.txt），登录后请修改`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`收到 ${signal}，正在退出`);
    void app.close().then(() => {
      ctx.db.$client.close();
      process.exit(0);
    });
  });
}

await app.listen({ port: config.port, host: config.host });
