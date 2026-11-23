// The record of accepted launches (docs/design/viz-backend.md > Data and API):
// one entry per launch_id, the first one received stays, bounded to the most
// recent `capacity` entries in the order they arrived (stream order). Kept in
// memory only; it is not a history.
import type { LaunchRequest } from '@albertoriorda95/trajectory-proto';

/** The default bound N of the spec. */
export const ACCEPTED_LAUNCHES_CAPACITY = 1000;

export interface AcceptedLaunch {
  launchId: string;
  acceptedAt: Date;
  request: LaunchRequest;
}

export class AcceptedLaunches {
  // A Map keeps insertion order: the first key is the oldest entry.
  readonly #entries = new Map<string, AcceptedLaunch>();
  readonly #capacity: number;

  constructor(capacity: number = ACCEPTED_LAUNCHES_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`capacity must be a positive integer, got ${capacity}`);
    }
    this.#capacity = capacity;
  }

  /** Adds the launch; returns false (and changes nothing) when its launch_id is already there. */
  add(launch: AcceptedLaunch): boolean {
    if (this.#entries.has(launch.launchId)) return false;
    this.#entries.set(launch.launchId, launch);
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
    return true;
  }

  /** The entries, newest first. */
  list(): AcceptedLaunch[] {
    return [...this.#entries.values()].reverse();
  }

  get size(): number {
    return this.#entries.size;
  }
}
