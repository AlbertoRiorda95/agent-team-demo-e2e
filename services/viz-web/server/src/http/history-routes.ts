// The history routes (server/openapi.yaml, docs/design/viewer.md > Data and
// API, History): `GET /api/launches` and `GET /api/launches/{id}/trajectory`.
// The query and the path are checked here, at the edge, before the use case
// runs; every error is an `application/problem+json` (as in
// docs/api/openapi.yaml).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { enumToJson, toJson } from '@bufbuild/protobuf';
import { TimestampSchema } from '@bufbuild/protobuf/wkt';
import {
  LaunchRequestSchema,
  TrajectoryComputedSchema,
  TrajectoryComputed_EndReasonSchema,
} from '@albertoriorda95/trajectory-proto';
import type { BrowseHistory } from '../application/browse-history.ts';
import { HistoryUnavailable } from '../application/ports.ts';
import {
  InvalidHistoryRequest,
  encodeCursor,
  parseCursor,
  parseLimit,
  type LaunchSummary,
} from '../domain/history.ts';

const PROBLEM_JSON = 'application/problem+json';
const JSON_OPTIONS = { useProtoFieldName: true, alwaysEmitImplicit: true } as const;

function problem(reply: FastifyReply, status: number, title: string, detail: string) {
  return reply
    .code(status)
    .type(PROBLEM_JSON)
    .send({ type: 'about:blank', title, status, detail });
}

/** One item of `GET /api/launches` (schema LaunchSummary). */
function toSummary(launch: LaunchSummary) {
  return {
    launch_id: launch.launchId,
    received_at: toJson(TimestampSchema, launch.receivedAt),
    computed_at: toJson(TimestampSchema, launch.computedAt),
    request: toJson(LaunchRequestSchema, launch.request, JSON_OPTIONS),
    end_reason: enumToJson(TrajectoryComputed_EndReasonSchema, launch.endReason),
    flight_time_s: launch.flightTimeS,
    max_height_m: launch.maxHeightM,
    range_m: launch.rangeM,
    sample_count: launch.sampleCount,
  };
}

export function registerHistoryRoutes(app: FastifyInstance, history: BrowseHistory): void {
  /** The problem answer of an error of the history; rethrows anything else (500). */
  function fail(reply: FastifyReply, error: unknown) {
    if (error instanceof InvalidHistoryRequest) {
      return problem(reply, 400, 'Invalid request', error.message);
    }
    if (error instanceof HistoryUnavailable) {
      reply.log.warn({ reason: error.message }, 'history unavailable');
      return problem(reply, 503, 'History unavailable', 'The database is not reachable; retry later.');
    }
    throw error;
  }

  app.get('/api/launches', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const limit = parseLimit(query.limit);
      const cursor = parseCursor(query.cursor);
      const page = await history.listLaunches(cursor, limit);
      return reply.send({
        items: page.items.map(toSummary),
        next_cursor: page.next === undefined ? null : encodeCursor(page.next),
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/launches/:id/trajectory', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const trajectory = await history.getTrajectory(id);
      if (trajectory === undefined) {
        return problem(reply, 404, 'Launch not found', `No stored launch has the id ${id}.`);
      }
      // PERF: about 15 MB of JSON at the contract's cap of 100000 samples.
      return reply.type('application/json').send(toJson(TrajectoryComputedSchema, trajectory, JSON_OPTIONS));
    } catch (error) {
      return fail(reply, error);
    }
  });
}
