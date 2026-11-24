package trajectory.store;

/** Health of the service: {@code ok} when the database, NATS and the consumer are all up. */
public enum Health {
  /** Database, NATS and consumer up. */
  OK,
  /** Something is down: the service keeps retrying (see {@link ServiceHealth.Report#detail}). */
  DEGRADED;

  /** "ok" or "degraded", as in the logs. */
  @Override
  public String toString() {
    return this == OK ? "ok" : "degraded";
  }
}
