// Configuration of the viz-web server, read from the environment only.

export interface ServerConfig {
  host: string;
  port: number;
  /** NATS_URL (same variable as the other services); undefined when unset. */
  natsUrl: string | undefined;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;

/** Reads VIZ_WEB_SERVER_HOST, VIZ_WEB_SERVER_PORT and NATS_URL; throws on an invalid port. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.VIZ_WEB_SERVER_HOST?.trim() || DEFAULT_HOST;
  const rawPort = env.VIZ_WEB_SERVER_PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`VIZ_WEB_SERVER_PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }
  const natsUrl = env.NATS_URL?.trim() || undefined;
  return { host, port, natsUrl };
}
