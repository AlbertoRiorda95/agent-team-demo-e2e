package trajectory.store;

import java.util.Map;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;

/**
 * The database schema: the Flyway migrations in {@code db/migration} (classpath), per table
 * prefix. The placeholder {@code ${prefix}} is in every name and each prefix has its own history
 * table, {@code <prefix>flyway_schema_history}: two prefixes migrate side by side.
 */
public final class Migrations {
  private Migrations() {}

  /**
   * Applies the pending migrations of the tables without prefix.
   *
   * @see #migrate(StoreConfig, TablePrefix)
   */
  public static MigrateResult migrate(StoreConfig config) {
    return migrate(config, TablePrefix.NONE);
  }

  /**
   * Applies the pending migrations of the tables of {@code prefix}.
   *
   * @param config where the database is
   * @param prefix the tables to migrate
   * @return Flyway's report
   * @throws org.flywaydb.core.api.FlywayException when the database cannot be reached or a
   *     migration fails
   */
  public static MigrateResult migrate(StoreConfig config, TablePrefix prefix) {
    return flyway(config, prefix, config.environmentCredentials()).migrate();
  }

  /**
   * Applies the pending migrations of the tables of {@code prefix} as {@code credentials}.
   *
   * @see #migrate(StoreConfig, TablePrefix)
   */
  public static MigrateResult migrate(
      StoreConfig config, TablePrefix prefix, DbCredentials credentials) {
    return flyway(config, prefix, credentials).migrate();
  }

  static Flyway flyway(StoreConfig config) {
    return flyway(config, TablePrefix.NONE);
  }

  static Flyway flyway(StoreConfig config, TablePrefix prefix) {
    return flyway(config, prefix, config.environmentCredentials());
  }

  static Flyway flyway(StoreConfig config, TablePrefix prefix, DbCredentials credentials) {
    return Flyway.configure()
        .dataSource(config.jdbcUrl(), credentials.user(), credentials.password())
        .locations("classpath:db/migration")
        .table(prefix.flywayHistory())
        .placeholders(Map.of("prefix", prefix.value()))
        // a new prefix finds the schema already holding the tables of the others: Flyway then
        // writes a baseline at version 0 in the new history table and still applies V1, V2...
        .baselineOnMigrate(true)
        .baselineVersion("0")
        .connectRetries(0) // the service retries with its own backoff and logs
        .load();
  }
}
