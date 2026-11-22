package trajectory.store;

/** Health of the service: {@code ok} when the schema is migrated and NATS is connected. */
public enum Health {
  /** Migrated and connected. */
  OK,
  /** Still waiting for PostgreSQL or NATS, or NATS lost: the service keeps retrying. */
  DEGRADED;

  /** "ok" or "degraded", as in the logs. */
  @Override
  public String toString() {
    return this == OK ? "ok" : "degraded";
  }
}
