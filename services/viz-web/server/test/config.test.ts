import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3001, natsUrl: undefined });
  });

  it('reads host, port and NATS_URL from the environment', () => {
    expect(
      loadConfig({
        VIZ_WEB_SERVER_HOST: '0.0.0.0',
        VIZ_WEB_SERVER_PORT: '8080',
        NATS_URL: ' nats://nats:4222 ',
      }),
    ).toEqual({ host: '0.0.0.0', port: 8080, natsUrl: 'nats://nats:4222' });
  });

  it('treats an empty NATS_URL as unset', () => {
    expect(loadConfig({ NATS_URL: '  ' }).natsUrl).toBeUndefined();
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ VIZ_WEB_SERVER_PORT: 'abc' })).toThrow(/VIZ_WEB_SERVER_PORT/);
    expect(() => loadConfig({ VIZ_WEB_SERVER_PORT: '70000' })).toThrow(/VIZ_WEB_SERVER_PORT/);
  });
});
