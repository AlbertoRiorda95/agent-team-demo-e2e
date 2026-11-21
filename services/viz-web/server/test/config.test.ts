import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3001 });
  });

  it('reads host and port from the environment', () => {
    expect(loadConfig({ VIZ_WEB_SERVER_HOST: '0.0.0.0', VIZ_WEB_SERVER_PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ VIZ_WEB_SERVER_PORT: 'abc' })).toThrow(/VIZ_WEB_SERVER_PORT/);
    expect(() => loadConfig({ VIZ_WEB_SERVER_PORT: '70000' })).toThrow(/VIZ_WEB_SERVER_PORT/);
  });
});
