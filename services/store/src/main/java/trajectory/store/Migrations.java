package trajectory.store;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;

/** The database schema: the Flyway migrations in {@code db/migration} (classpath). */
public final class Migrations {
  private Migrations() {}

  /**
   * Applies the pending migrations.
   *
   * @param config where the database is
   * @return Flyway's report
   * @throws org.flywaydb.core.api.FlywayException when the database cannot be reached or a
   *     migration fails
   */
  public static MigrateResult migrate(StoreConfig config) {
    return flyway(config).migrate();
  }

  static Flyway flyway(StoreConfig config) {
    return Flyway.configure()
        .dataSource(config.jdbcUrl(), config.databaseUser(), config.databasePassword())
        .locations("classpath:db/migration")
        .connectRetries(0) // the service retries with its own backoff and logs
        .load();
  }
}
