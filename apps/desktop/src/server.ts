// 桌面版的本机服务：和服务器版同一套代码，由主进程在独立进程里启动（出错不会拖垮窗口和托盘）。
// 启动成功告诉主进程 ready；主进程要退出时发 stop，这里断开直播间、关掉数据库后退出
import { buildApp } from '../../server/src/app.ts';
import { loadConfig } from '../../server/src/config.ts';
import { createContext, startBackground } from '../../server/src/context.ts';

const parent = process.parentPort;

process.on('unhandledRejection', (e) => console.error('[星临] 未处理的异步错误：', e));
process.on('uncaughtException', (e) => {
  console.error('[星临] 未处理的异常，服务将重启：', e);
  process.exit(1);
});

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createContext(config);
  const app = await buildApp(ctx, { logger: true });
  const stopBackground = await startBackground(ctx);
  parent.on('message', (e: { data?: { type?: string } }) => {
    if (e.data?.type !== 'stop') return;
    app.log.info('桌面版退出，服务收尾');
    stopBackground();
    void app.close().then(() => {
      ctx.db.$client.close();
      process.exit(0);
    });
  });
  await app.listen({ port: config.port, host: config.host });
  parent.postMessage({ type: 'ready' });
}

main().catch((e: Error) => {
  console.error('[星临] 服务启动失败：', e);
  parent.postMessage({ type: 'fatal', message: e.message });
  // 等消息送到主进程再退出
  setTimeout(() => process.exit(1), 200);
});
