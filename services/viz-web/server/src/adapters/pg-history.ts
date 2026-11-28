// The PostgreSQL adapter of the history port (application/ports.ts), with
// node-postgres. It reads the store tables of V2 (`<prefix>launches`,
// `<prefix>trajectory_samples`) as the read-only user (`viz_web`, member of
// `trajectory_reader`, docs/design/viewer.md > Read-only database user): only
// SELECT statements.
// - Timestamps are read as text with their microseconds (a JS Date keeps
//   milliseconds only), so the history equals the message store consumed.
// - The prefix is checked against the format of config.proto and quoted as an
//   identifier: it never reaches the SQL as free text.
// - Any database error (unreachable, timeout, missing table, permission) is a
//   HistoryUnavailable: the routes answer 503 and the server keeps running.
import pg from 'pg';
import { create, fromJson, toJson } from '@bufbuild/protobuf';
import { TimestampSchema } from '@bufbuild/protobuf/wkt';
import {
  LaunchRequestSchema,
  Sample_Phase,
  TrajectoryComputedSchema,
  TrajectoryComputed_EndReason,
  type TrajectoryComputed,
} from '@albertoriorda95/trajectory-proto';
import { type HistoryRepository, HistoryUnavailable, type Logger } from '../application/ports.ts';
import type { HistoryCursor, LaunchSummary } from '../domain/history.ts';
import { isTablePrefix } from '../domain/table-prefix.ts';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface PgHistoryOptions {
  database: DatabaseConfig;
  logger: Logger;
  /** Connections of the pool (5 by default). */
  maxConnections?: number;
  /** How long to wait for a connection, in ms (2 s by default). */
  connectTimeoutMs?: number;
  /** How long a statement may run, in ms (10 s by default). */
  statementTimeoutMs?: number;
}

/** The text form of a timestamptz column, UTC with microseconds (RFC 3339). */
function utcText(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

const LAUNCH_COLUMNS = [
  'id::text AS id',
  `${utcText('received_at')} AS received_at`,
  `${utcText('computed_at')} AS computed_at`,
  'mass_kg',
  'x_m',
  'y_m',
  'z_m',
  'azimuth_deg',
  'elevation_deg',
  'force_n',
  'burn_duration_s',
  'propagation_time_s',
  'sample_step_s',
  'gravity_mps2',
  'config_version::text AS config_version',
  'end_reason',
  'flight_time_s',
  'max_height_m',
  'range_m',
  'sample_count',
].join(', ');

interface LaunchRow {
  id: string;
  received_at: string;
  computed_at: string;
  mass_kg: number;
  x_m: number;
  y_m: number;
  z_m: number;
  azimuth_deg: number;
  elevation_deg: number;
  force_n: number;
  burn_duration_s: number;
  propagation_time_s: number;
  sample_step_s: number;
  gravity_mps2: number;
  config_version: string;
  end_reason: string;
  flight_time_s: number;
  max_height_m: number;
  range_m: number;
  sample_count: number;
}

interface SampleRow {
  seq: number;
  t_s: number;
  x_m: number;
  y_m: number;
  z_m: number;
  vx_mps: number;
  vy_mps: number;
  vz_mps: number;
  phase: string;
}

/** The column values of TrajectoryRows (services/store) back to the enums. */
function endReason(value: string): TrajectoryComputed_EndReason {
  switch (value) {
    case 'ground':
      return TrajectoryComputed_EndReason.GROUND;
    case 'time_limit':
      return TrajectoryComputed_EndReason.TIME_LIMIT;
    default:
      throw new HistoryUnavailable(`stored end_reason "${value}" is unknown`);
  }
}

function phase(value: string): Sample_Phase {
  switch (value) {
    case 'burn':
      return Sample_Phase.BURN;
    case 'ballistic':
      return Sample_Phase.BALLISTIC;
    default:
      throw new HistoryUnavailable(`stored phase "${value}" is unknown`);
  }
}

function request(row: LaunchRow) {
  return {
    massKg: row.mass_kg,
    position: { xM: row.x_m, yM: row.y_m, zM: row.z_m },
    azimuthDeg: row.azimuth_deg,
    elevationDeg: row.elevation_deg,
    forceN: row.force_n,
    burnDurationS: row.burn_duration_s,
  };
}

function summary(row: LaunchRow): LaunchSummary {
  return {
    launchId: row.id,
    receivedAt: fromJson(TimestampSchema, row.received_at),
    computedAt: fromJson(TimestampSchema, row.computed_at),
    request: create(LaunchRequestSchema, request(row)),
    endReason: endReason(row.end_reason),
    flightTimeS: row.flight_time_s,
    maxHeightM: row.max_height_m,
    rangeM: row.range_m,
    sampleCount: row.sample_count,
  };
}

export class PgHistory implements HistoryRepository {
  readonly #pool: pg.Pool;
  readonly #log: Logger;

  constructor(options: PgHistoryOptions) {
    this.#log = options.logger;
    this.#pool = new pg.Pool({
      host: options.database.host,
      port: options.database.port,
      database: options.database.database,
      user: options.database.user,
      password: options.database.password,
      application_name: 'viz-web',
      max: options.maxConnections ?? 5,
      connectionTimeoutMillis: options.connectTimeoutMs ?? 2000,
      statement_timeout: options.statementTimeoutMs ?? 10_000,
      idleTimeoutMillis: 30_000,
    });
    // an idle connection that breaks (PostgreSQL restarted) must not crash the server
    this.#pool.on('error', (error) => this.#log.warn({ err: error }, 'idle PostgreSQL connection lost'));
  }

  async listLaunches(prefix: string, after: HistoryCursor | undefined, limit: number): Promise<LaunchSummary[]> {
    const launches = tables(prefix).launches;
    // PERF: the V2 index is on received_at DESC only; the id tie-break is sorted in memory per timestamp.
    const sql =
      after === undefined
        ? `SELECT ${LAUNCH_COLUMNS} FROM ${launches} ORDER BY received_at DESC, id DESC LIMIT $1`
        : `SELECT ${LAUNCH_COLUMNS} FROM ${launches}
           WHERE (received_at, id) < ($2::timestamptz, $3::uuid)
           ORDER BY received_at DESC, id DESC LIMIT $1`;
    // the cursor's timestamp as RFC 3339 text, which PostgreSQL parses to the microsecond
    const params =
      after === undefined ? [limit] : [limit, toJson(TimestampSchema, after.receivedAt), after.launchId];
    const result = await this.#query<LaunchRow>(sql, params);
    return result.rows.map(summary);
  }

  async findTrajectory(prefix: string, launchId: string): Promise<TrajectoryComputed | undefined> {
    const { launches, samples } = tables(prefix);
    const launch = await this.#query<LaunchRow>(
      `SELECT ${LAUNCH_COLUMNS} FROM ${launches} WHERE id = $1::uuid`,
      [launchId],
    );
    const row = launch.rows[0];
    if (row === undefined) return undefined;
    // PERF: up to 100000 rows (the contract's cap) in one result.
    const sampleRows = await this.#query<SampleRow>(
      `SELECT seq, t_s, x_m, y_m, z_m, vx_mps, vy_mps, vz_mps, phase
       FROM ${samples} WHERE launch_id = $1::uuid ORDER BY seq`,
      [launchId],
    );
    return create(TrajectoryComputedSchema, {
      launchId: row.id,
      // the api's accepted_at is stored as received_at (services/store TrajectoryRows)
      acceptedAt: fromJson(TimestampSchema, row.received_at),
      computedAt: fromJson(TimestampSchema, row.computed_at),
      request: request(row),
      config: {
        propagationTimeS: row.propagation_time_s,
        sampleStepS: row.sample_step_s,
        gravityMps2: row.gravity_mps2,
        configVersion: BigInt(row.config_version),
      },
      endReason: endReason(row.end_reason),
      flightTimeS: row.flight_time_s,
      maxHeightM: row.max_height_m,
      rangeM: row.range_m,
      samples: sampleRows.rows.map((s) => ({
        seq: s.seq,
        tS: s.t_s,
        xM: s.x_m,
        yM: s.y_m,
        zM: s.z_m,
        vxMps: s.vx_mps,
        vyMps: s.vy_mps,
        vzMps: s.vz_mps,
        phase: phase(s.phase),
      })),
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #query<Row extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<pg.QueryResult<Row>> {
    try {
      return await this.#pool.query<Row>(sql, params);
    } catch (error) {
      this.#log.warn({ err: error }, 'history query failed');
      throw new HistoryUnavailable(`database unavailable: ${(error as Error).message}`);
    }
  }
}

/** The quoted table names of a prefix. */
function tables(prefix: string): { launches: string; samples: string } {
  if (!isTablePrefix(prefix)) throw new HistoryUnavailable(`invalid table prefix "${prefix}"`);
  return {
    launches: pg.escapeIdentifier(`${prefix}launches`),
    samples: pg.escapeIdentifier(`${prefix}trajectory_samples`),
  };
}
