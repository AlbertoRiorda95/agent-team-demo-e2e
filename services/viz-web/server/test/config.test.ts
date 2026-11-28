import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3001, natsUrl: undefined, database: undefined });
  });

  it('reads host, port and NATS_URL from the environment', () => {
    expect(
      loadConfig({
        VIZ_WEB_SERVER_HOST: '0.0.0.0',
        VIZ_WEB_SERVER_PORT: '8080',
        NATS_URL: ' nats://nats:4222 ',
      }),
    ).toEqual({ host: '0.0.0.0', port: 8080, natsUrl: 'nats://nats:4222', database: undefined });
  });

  it('treats an empty NATS_URL as unset', () => {
    expect(loadConfig({ NATS_URL: '  ' }).natsUrl).toBeUndefined();
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ VIZ_WEB_SERVER_PORT: 'abc' })).toThrow(/VIZ_WEB_SERVER_PORT/);
    expect(() => loadConfig({ VIZ_WEB_SERVER_PORT: '70000' })).toThrow(/VIZ_WEB_SERVER_PORT/);
  });

  it('reads the database from DATABASE_URL, DATABASE_USER and DATABASE_PASSWORD', () => {
    expect(
      loadConfig({
        DATABASE_URL: 'postgresql://postgres:5433/trajectory',
        DATABASE_USER: 'viz_web',
        DATABASE_PASSWORD: 'secret',
      }).database,
    ).toEqual({ host: 'postgres', port: 5433, database: 'trajectory', user: 'viz_web', password: 'secret' });
    expect(
      loadConfig({ DATABASE_URL: 'postgres://db/history', DATABASE_USER: 'u', DATABASE_PASSWORD: 'p' }).database,
    ).toMatchObject({ host: 'db', port: 5432, database: 'history' });
  });

  it('rejects a bad DATABASE_URL, credentials in it, or a missing user or password', () => {
    const credentials = { DATABASE_USER: 'u', DATABASE_PASSWORD: 'p' };
    expect(() => loadConfig({ DATABASE_URL: 'mysql://db/x', ...credentials })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://db', ...credentials })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'not a url', ...credentials })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://u:hunter2@db/x', ...credentials })).toThrow(
      /must not contain credentials/,
    );
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://db/x', DATABASE_PASSWORD: 'p' })).toThrow(/DATABASE_USER/);
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://db/x', DATABASE_USER: 'u' })).toThrow(/DATABASE_PASSWORD/);
  });

  it('never puts the password in an error', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://u:hunter2@db/x' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
  });
});
