package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import org.flywaydb.core.api.MigrationState;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** The Flyway migrations on an empty PostgreSQL 17 (Testcontainers; needs Docker). */
class MigrationTest {
  private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17-alpine");

  @BeforeAll
  static void startDatabase() {
    POSTGRES.start();
  }

  @AfterAll
  static void stopDatabase() {
    POSTGRES.stop();
  }

  /** The configuration as the service reads it, from the variables of .env.example. */
  private static StoreConfig config() {
    return StoreConfig.fromEnvironment(
        Map.of(
            "DATABASE_URL",
            "postgresql://" + POSTGRES.getHost() + ":" + POSTGRES.getFirstMappedPort() + "/"
                + POSTGRES.getDatabaseName(),
            "DATABASE_USER", POSTGRES.getUsername(),
            "DATABASE_PASSWORD", POSTGRES.getPassword()));
  }

  @Test
  void appliesTheBaselineOnAnEmptyDatabase() throws SQLException {
    var result = Migrations.migrate(config());
    assertTrue(result.success);
    assertEquals("1", result.targetSchemaVersion);

    var applied = Migrations.flyway(config()).info().applied();
    assertEquals(1, applied.length);
    assertEquals("1", applied[0].getVersion().getVersion());
    assertEquals("baseline", applied[0].getDescription());
    assertEquals(MigrationState.SUCCESS, applied[0].getState());

    try (var conn =
            DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        var rs =
            conn.createStatement()
                .executeQuery(
                    "SELECT count(*) FROM information_schema.tables"
                        + " WHERE table_schema = 'public' AND table_name <> 'flyway_schema_history'")) {
      rs.next();
      assertEquals(0, rs.getInt(1), "the baseline creates no table");
    }

    // a second run on the migrated database applies nothing
    assertEquals(0, Migrations.migrate(config()).migrationsExecuted);
  }
}
