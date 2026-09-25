import { DEFAULT_PORT } from '@starfall/shared';
import { buildApp } from './app.ts';

const port = Number(process.env.STARFALL_PORT) || DEFAULT_PORT;
const host = process.env.STARFALL_HOST || '0.0.0.0';

const app = buildApp({ logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`收到 ${signal}，正在退出`);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host });
