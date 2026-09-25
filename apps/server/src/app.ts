import Fastify from 'fastify';
import { APP_NAME } from '@starfall/shared';

export interface AppOptions {
  logger?: boolean;
}

export function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get('/api/health', async () => ({ ok: true, name: APP_NAME, time: Date.now() }));

  return app;
}
