// The latest computed trajectory (docs/design/viewer.md > User flows, Live
// stream): what a new client of the live stream gets first. Kept in memory
// only; the consumer reads the last message of the stream at start-up, so it
// survives a restart. The same trajectory delivered twice is kept once.
import type { TrajectoryComputed } from '@albertoriorda95/trajectory-proto';

export class LatestTrajectory {
  #current: TrajectoryComputed | undefined;

  /** Keeps the trajectory as the latest; returns false (and changes nothing) when it has the latest's launch_id. */
  offer(trajectory: TrajectoryComputed): boolean {
    if (this.#current?.launchId === trajectory.launchId) return false;
    this.#current = trajectory;
    return true;
  }

  get current(): TrajectoryComputed | undefined {
    return this.#current;
  }
}
