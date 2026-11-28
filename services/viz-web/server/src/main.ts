// Entry point of the viz-web server: `npm start` (node runs the TypeScript
// directly, Node 24 type stripping). Logs are structured JSON (pino).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NatsBus } from './adapters/nats-bus.ts';
import { loadConfig } from './config.ts';
import { createServer } from './server.ts';

const config = loadConfig();
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const server = createServer({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  version,
  // the UI built by `npm run build -w services/viz-web`
  uiDir: fileURLToPath(new URL('../../dist/', import.meta.url)),
  createBus: (logger) =>
    config.natsUrl === undefined ? undefined : new NatsBus({ url: config.natsUrl, logger }),
});
const { app } = server;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void server.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'viz-web server failed to start');
  process.exit(1);
}
