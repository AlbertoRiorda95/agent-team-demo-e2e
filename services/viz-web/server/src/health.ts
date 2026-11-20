// Health of the viz-web server: the answer of `GET /healthz`
// (server/openapi.yaml). The server is `ok` when every dependency check
// passes, `degraded` otherwise; it never crashes because a dependency is down.

/** A dependency the server needs (NATS, PostgreSQL): true when reachable. */
export type HealthCheck = () => boolean | Promise<boolean>;

export type HealthStatus = 'ok' | 'degraded';

/** Runs every check; a check that throws counts as failed. */
export async function healthStatus(checks: readonly HealthCheck[]): Promise<HealthStatus> {
  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        return await check();
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean) ? 'ok' : 'degraded';
}
