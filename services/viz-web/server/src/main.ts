// Entry point of the viz-web server: `npm start` (node runs the TypeScript
// directly, Node 24 type stripping). Logs are structured JSON (pino).
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = buildApp({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'viz-web server failed to start');
  process.exit(1);
}
