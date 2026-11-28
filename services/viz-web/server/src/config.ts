// Configuration of the viz-web server, read from the environment only.
import type { DatabaseConfig } from './adapters/pg-history.ts';

export interface ServerConfig {
  host: string;
  port: number;
  /** NATS_URL (same variable as the other services); undefined when unset. */
  natsUrl: string | undefined;
  /**
   * DATABASE_URL, DATABASE_USER and DATABASE_PASSWORD (the same names as
   * store, the read-only user's values); undefined when DATABASE_URL is unset.
   */
  database: DatabaseConfig | undefined;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;
const DEFAULT_DATABASE_PORT = 5432;
const URL_FORMAT = 'DATABASE_URL must be postgresql://<host>[:<port>]/<database>';

/**
 * Reads VIZ_WEB_SERVER_HOST, VIZ_WEB_SERVER_PORT, NATS_URL and DATABASE_*;
 * throws on an invalid port or database setting (never with the password in
 * the message).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.VIZ_WEB_SERVER_HOST?.trim() || DEFAULT_HOST;
  const rawPort = env.VIZ_WEB_SERVER_PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`VIZ_WEB_SERVER_PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }
  const natsUrl = env.NATS_URL?.trim() || undefined;
  return { host, port, natsUrl, database: loadDatabase(env) };
}

function loadDatabase(env: NodeJS.ProcessEnv): DatabaseConfig | undefined {
  const rawUrl = env.DATABASE_URL?.trim();
  if (!rawUrl) return undefined;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(URL_FORMAT);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error(URL_FORMAT);
  if (url.username !== '' || url.password !== '') {
    throw new Error('DATABASE_URL must not contain credentials: use DATABASE_USER and DATABASE_PASSWORD');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (url.hostname === '' || database === '' || database.includes('/')) throw new Error(URL_FORMAT);
  const dbPort = url.port === '' ? DEFAULT_DATABASE_PORT : Number(url.port);

  const user = env.DATABASE_USER?.trim();
  if (!user) throw new Error('DATABASE_USER must be set when DATABASE_URL is set');
  const password = env.DATABASE_PASSWORD;
  if (password === undefined || password === '') {
    throw new Error('DATABASE_PASSWORD must be set when DATABASE_URL is set');
  }
  // IPv6 hosts come bracketed from URL
  const hostName = url.hostname.replace(/^\[(.*)\]$/, '$1');
  return { host: hostName, port: dbPort, database, user, password };
}
