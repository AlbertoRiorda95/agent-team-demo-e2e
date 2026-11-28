// Use cases "History" (docs/design/viewer.md > User flows 4, Data and API):
// a page of the stored launches of the prefix in force, newest first, and one
// stored trajectory. Every request reads the prefix in force at that moment,
// so a new `config.store.applied` takes effect on the next request.
import type { TrajectoryComputed } from '@albertoriorda95/trajectory-proto';
import { type HistoryCursor, type HistoryPage, InvalidHistoryRequest } from '../domain/history.ts';
import type { TablePrefix } from '../domain/table-prefix.ts';
import { UUID } from '../domain/uuid.ts';
import { type HistoryRepository, HistoryUnavailable } from './ports.ts';

export interface BrowseHistoryDeps {
  /** Undefined when the database is not configured: every read is unavailable. */
  repository: HistoryRepository | undefined;
  prefix: TablePrefix;
}

export interface BrowseHistory {
  /** Throws HistoryUnavailable. */
  listLaunches(after: HistoryCursor | undefined, limit: number): Promise<HistoryPage>;
  /** Throws InvalidHistoryRequest (not a UUID) or HistoryUnavailable; undefined when unknown. */
  getTrajectory(launchId: string): Promise<TrajectoryComputed | undefined>;
}

function configured(repository: HistoryRepository | undefined): HistoryRepository {
  if (repository === undefined) throw new HistoryUnavailable('the database is not configured');
  return repository;
}

export function browseHistory(deps: BrowseHistoryDeps): BrowseHistory {
  return {
    async listLaunches(after, limit) {
      // one row more than the page tells whether there is a next page
      const rows = await configured(deps.repository).listLaunches(deps.prefix.current, after, limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const next =
        rows.length > limit && last !== undefined
          ? { receivedAt: last.receivedAt, launchId: last.launchId }
          : undefined;
      return { items, next };
    },
    async getTrajectory(launchId) {
      if (!UUID.test(launchId)) throw new InvalidHistoryRequest('id must be a UUID');
      return configured(deps.repository).findTrajectory(deps.prefix.current, launchId.toLowerCase());
    },
  };
}
