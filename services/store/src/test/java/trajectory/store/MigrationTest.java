package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationState;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** The Flyway migrations on a fresh PostgreSQL 17 per test (Testcontainers; needs Docker). */
class MigrationTest {
  private PostgreSQLContainer postgres;

  @BeforeEach
  void startDatabase() {
    postgres = TestInfra.postgres();
    postgres.start();
  }

  @AfterEach
  void stopDatabase() {
    postgres.stop();
  }

  /** The configuration as the service reads it, from the variables of .env.example. */
  private StoreConfig config() {
    return StoreConfig.fromEnvironment(
        Map.of(
            "DATABASE_URL",
            "postgresql://" + postgres.getHost() + ":" + postgres.getFirstMappedPort() + "/"
                + postgres.getDatabaseName(),
            "DATABASE_USER", postgres.getUsername(),
            "DATABASE_PASSWORD", postgres.getPassword()));
  }

  private Connection connect() throws SQLException {
    return DriverManager.getConnection(
        postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
  }

  /** The names of the tables, indexes and constraints of the public schema. */
  private TreeSet<String> objects() throws SQLException {
    TreeSet<String> names = new TreeSet<>();
    try (var conn = connect();
        var rs =
            conn.createStatement()
                .executeQuery(
                    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
                        + " WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i')"
                        + " UNION SELECT conname FROM pg_constraint c"
                        + " JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'"
                        + " AND c.contype <> 'n'")) {
      while (rs.next()) {
        names.add(rs.getString(1));
      }
    }
    return names;
  }

  private static List<String> v2Objects(String p) {
    return List.of(
        p + "launches",
        p + "launches_pkey",
        p + "launches_status_check",
        p + "launches_end_reason_check",
        p + "launches_received_at_idx",
        p + "trajectory_samples",
        p + "trajectory_samples_pkey",
        p + "trajectory_samples_launch_id_fkey",
        p + "trajectory_samples_phase_check");
  }

  /** The migrations applied (the version-0 baseline marker of a second prefix left out). */
  private static List<String> versions(Flyway flyway) {
    return java.util.Arrays.stream(flyway.info().applied())
        .filter(m -> m.getType() != org.flywaydb.core.api.CoreMigrationType.BASELINE)
        .peek(m -> assertEquals(MigrationState.SUCCESS, m.getState()))
        .map(m -> m.getVersion().getVersion())
        .toList();
  }

  @Test
  void appliesEveryMigrationOnAnEmptyDatabase() throws SQLException {
    var result = Migrations.migrate(config());
    assertTrue(result.success);
    assertEquals("3", result.targetSchemaVersion);

    var applied = Migrations.flyway(config()).info().applied();
    assertEquals(3, applied.length);
    assertEquals("baseline", applied[0].getDescription());
    assertEquals("launches and samples", applied[1].getDescription());
    assertEquals("trajectory reader role", applied[2].getDescription());
    for (var m : applied) {
      assertEquals(MigrationState.SUCCESS, m.getState());
    }
    assertTrue(objects().containsAll(v2Objects("")), objects().toString());

    // a second run on the migrated database applies nothing
    assertEquals(0, Migrations.migrate(config()).migrationsExecuted);
  }

  @Test
  void appliesV2AndV3OnTheV1Baseline() throws SQLException {
    // the database of foundations: V1 only
    Flyway.configure()
        .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
        .locations("classpath:db/migration")
        .placeholders(Map.of("prefix", ""))
        .target("1")
        .load()
        .migrate();
    assertEquals("1", Migrations.flyway(config()).info().current().getVersion().getVersion());

    var result = Migrations.migrate(config());
    assertEquals(2, result.migrationsExecuted);
    assertEquals("3", result.targetSchemaVersion);
    assertTrue(objects().containsAll(v2Objects("")));
  }

  @Test
  void aSecondPrefixMigratesItsOwnTablesNextToTheFirst() throws SQLException {
    Migrations.migrate(config());
    TreeSet<String> before = objects();

    var demo = new TablePrefix("demo_");
    var result = Migrations.migrate(config(), demo);
    assertTrue(result.success);
    assertEquals(3, result.migrationsExecuted);

    TreeSet<String> after = objects();
    assertTrue(after.containsAll(before), "the tables without prefix are kept");
    assertTrue(after.containsAll(v2Objects("demo_")), after.toString());
    assertTrue(after.contains("demo_flyway_schema_history"));
    assertEquals(List.of("1", "2", "3"), versions(Migrations.flyway(config(), demo)));
    assertEquals(List.of("1", "2", "3"), versions(Migrations.flyway(config())));
  }

  /** Whether trajectory_reader has the privilege on the table (has_table_privilege). */
  private boolean readerCan(String table, String privilege) throws SQLException {
    try (var conn = connect();
        var st = conn.prepareStatement("SELECT has_table_privilege('trajectory_reader', ?, ?)")) {
      st.setString(1, table);
      st.setString(2, privilege);
      try (var rs = st.executeQuery()) {
        rs.next();
        return rs.getBoolean(1);
      }
    }
  }

  private void assertReadOnly(String prefix) throws SQLException {
    for (String table : List.of(prefix + "launches", prefix + "trajectory_samples")) {
      assertTrue(readerCan(table, "SELECT"), "SELECT on " + table);
      for (String write : List.of("INSERT", "UPDATE", "DELETE", "TRUNCATE")) {
        assertFalse(readerCan(table, write), write + " on " + table);
      }
    }
  }

  @Test
  void v3CreatesTheNologinReaderRoleAndGrantsSelectOnEveryPrefix() throws SQLException {
    Migrations.migrate(config());
    try (var conn = connect();
        var rs =
            conn.createStatement()
                .executeQuery(
                    "SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolinherit"
                        + " FROM pg_roles WHERE rolname = 'trajectory_reader'")) {
      assertTrue(rs.next(), "the role exists");
      assertFalse(rs.getBoolean("rolcanlogin"), "NOLOGIN");
      assertFalse(rs.getBoolean("rolsuper"));
      assertFalse(rs.getBoolean("rolcreaterole"));
      assertFalse(rs.getBoolean("rolcreatedb"));
    }
    assertReadOnly("");

    // a second prefix reuses the existing role and grants its own tables
    var demo = new TablePrefix("demo_");
    assertTrue(Migrations.migrate(config(), demo).success);
    assertReadOnly("demo_");
    assertReadOnly("");
    try (var conn = connect();
        var rs =
            conn.createStatement()
                .executeQuery(
                    "SELECT count(*) FROM pg_roles WHERE rolname = 'trajectory_reader'")) {
      rs.next();
      assertEquals(1, rs.getInt(1));
    }
  }

  @Test
  void aMemberOfTheReaderRoleReadsButCannotWrite() throws SQLException {
    Migrations.migrate(config());
    var demo = new TablePrefix("demo_");
    Migrations.migrate(config(), demo);
    try (var conn = connect(); var st = conn.createStatement()) {
      st.execute("SET ROLE trajectory_reader");
      for (String p : List.of("", "demo_")) {
        try (var rs = st.executeQuery("SELECT count(*) FROM " + p + "launches")) {
          assertTrue(rs.next());
        }
        try (var rs = st.executeQuery("SELECT count(*) FROM " + p + "trajectory_samples")) {
          assertTrue(rs.next());
        }
        for (String write :
            List.of(
                "DELETE FROM " + p + "launches",
                "UPDATE " + p + "trajectory_samples SET seq = seq",
                "INSERT INTO " + p + "trajectory_samples (launch_id, seq, t_s, x_m, y_m, z_m,"
                    + " vx_mps, vy_mps, vz_mps, phase) VALUES (gen_random_uuid(), 0, 0, 0, 0, 0,"
                    + " 0, 0, 0, 'burn')")) {
          var e = assertThrows(SQLException.class, () -> st.execute(write), write);
          assertEquals("42501", e.getSQLState(), write + ": " + e.getMessage());
        }
      }
    }
  }
}
