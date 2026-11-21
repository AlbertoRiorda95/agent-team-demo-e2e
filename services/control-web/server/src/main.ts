// Entry point: `npm run start:server -w services/control-web`.
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';

// Fastify's logger writes structured JSON lines (pino).
const app = buildServer({ logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

try {
  const config = loadConfig();
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error({ err }, 'cannot start the server');
  process.exit(1);
}
