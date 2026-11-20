// Configuration from the environment (`.env.example`), validated at start-up.
export interface ServerConfig {
  host: string;
  port: number;
}

const DEFAULT_PORT = 5174;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = env.CONTROL_WEB_PORT;
  const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`CONTROL_WEB_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  // all interfaces: the server runs in a container
  return { host: '0.0.0.0', port };
}
