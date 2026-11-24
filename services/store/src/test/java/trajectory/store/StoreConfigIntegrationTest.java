package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.ByteString;
import io.nats.client.Connection;
import io.nats.client.Message;
import io.nats.client.Nats;
import io.nats.client.Subscription;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import trajectory.v1.Config.ConfigApplied;
import trajectory.v1.Config.ConfigSet;
import trajectory.v1.Config.StoreConfig;
import trajectory.v1.Service.ServiceStatus;
import trajectory.v1.Trajectory.TrajectoryComputed;
import trajectory.v1.Trajectory.TrajectoryStored;

/**
 * Integration: {@code config.store.set} against PostgreSQL 17 and NATS in Testcontainers. One
 * store at a time (they share the durable consumer); each test its own prefixes and config file.
 */
class StoreConfigIntegrationTest {
  private static final Duration WAIT = Duration.ofSeconds(15);
  private static final String WRITER = "writer2";
  private static final String WRITER_PASSWORD = "Wr1ter-2-secret-pw";

  private static PostgreSQLContainer postgres;
  private static GenericContainer<?> natsServer;
  private static Connection nats;

  @TempDir Path dir;
  private final List<StoreService> stores = new ArrayList<>();
  private final List<byte[]> answers = new ArrayList<>();
  private final ByteArrayOutputStream logs = new ByteArrayOutputStream();

  @BeforeAll
  static void start() throws Exception {
    postgres = TestInfra.postgres();
    natsServer = TestInfra.nats();
    postgres.start();
    natsServer.start();
    TestInfra.createStreams(natsServer);
    nats = Nats.connect(TestInfra.natsUrl(natsServer));
    try (var conn = admin();
        var st = conn.createStatement()) {
      // a second write user, as an operator would create it
      st.execute("CREATE ROLE " + WRITER + " LOGIN PASSWORD '" + WRITER_PASSWORD + "'");
      st.execute("GRANT CREATE, USAGE ON SCHEMA public TO " + WRITER);
      st.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO " + WRITER);
    }
  }

  @AfterAll
  static void stop() throws InterruptedException {
    if (nats != null) {
      nats.close();
    }
    natsServer.stop();
    postgres.stop();
  }

  @AfterEach
  void closeStores() {
    stores.forEach(StoreService::close);
  }

  private static java.sql.Connection admin() throws SQLException {
    return DriverManager.getConnection(
        postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
  }

  private StoreService startStore(Optional<CredentialSealing> key) throws Exception {
    StoreService store =
        new StoreService(
            TestInfra.config(postgres, natsServer).withConfig(dir.resolve("config.json"), key),
            new JsonLog(new PrintStream(logs, true, StandardCharsets.UTF_8)),
            Thread::sleep,
            Duration.ofMillis(500));
    stores.add(store);
    store.start();
    return store;
  }

  private ConfigApplied nextApplied(Subscription sub) throws Exception {
    Message m = sub.nextMessage(WAIT);
    assertNotNull(m, "no ConfigApplied; logs: " + logs.toString(StandardCharsets.UTF_8));
    answers.add(m.getData());
    ConfigApplied a = ConfigApplied.parseFrom(m.getData());
    assertEquals("store", a.getService());
    assertTrue(a.getStore().getDbCredentialsSealed().isEmpty(), "write-only credentials");
    return a;
  }

  private ConfigApplied set(Subscription applied, long version, String prefix, byte[] sealed)
      throws Exception {
    ConfigSet set =
        ConfigSet.newBuilder()
            .setService("store")
            .setConfigVersion(version)
            .setStore(
                StoreConfig.newBuilder()
                    .setTablePrefix(prefix)
                    .setDbCredentialsSealed(ByteString.copyFrom(sealed)))
            .build();
    nats.publish(Subjects.CONFIG_SET, set.toByteArray());
    return nextApplied(applied);
  }

  private static void storeOne(TrajectoryComputed t) throws Exception {
    Subscription stored = nats.subscribe(Subjects.TRAJECTORIES_STORED);
    nats.jetStream().publish(Subjects.TRAJECTORIES_COMPUTED, t.toByteArray());
    while (true) {
      Message m = stored.nextMessage(WAIT);
      assertNotNull(m, "no TrajectoryStored for " + t.getLaunchId());
      if (TrajectoryStored.parseFrom(m.getData()).getLaunchId().equals(t.getLaunchId())) {
        stored.unsubscribe();
        return;
      }
    }
  }

  private static int count(String table, String launchId) throws SQLException {
    try (var conn = admin();
        var ps =
            conn.prepareStatement(
                "SELECT count(*) FROM " + table
                    + (launchId == null ? "" : " WHERE " + (table.endsWith("launches") ? "id" : "launch_id") + " = ?"))) {
      if (launchId != null) {
        ps.setObject(1, UUID.fromString(launchId));
      }
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getInt(1);
      }
    }
  }

  /** The users of the store's open database connections. */
  private static List<String> storeUsers() throws SQLException {
    List<String> users = new ArrayList<>();
    try (var conn = admin();
        var rs =
            conn.createStatement()
                .executeQuery(
                    "SELECT usename FROM pg_stat_activity WHERE application_name = 'store'")) {
      while (rs.next()) {
        users.add(rs.getString(1));
      }
    }
    return users;
  }

  private static boolean tableExists(String name) throws SQLException {
    try (var conn = admin();
        var ps = conn.prepareStatement("SELECT to_regclass(?) IS NOT NULL")) {
      ps.setString(1, "public." + name);
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getBoolean(1);
      }
    }
  }

  private void assertNoPasswordAnywhere() throws Exception {
    String text = logs.toString(StandardCharsets.UTF_8);
    assertFalse(text.contains(WRITER_PASSWORD), "password in the logs");
    assertFalse(text.contains(postgres.getPassword() + "\""), "env password in the logs");
    Path file = dir.resolve("config.json");
    if (Files.exists(file)) {
      assertFalse(Files.readString(file).contains(WRITER_PASSWORD), "password in the file");
    }
    for (byte[] a : answers) {
      assertFalse(
          new String(a, StandardCharsets.ISO_8859_1).contains(WRITER_PASSWORD),
          "password in a ConfigApplied");
    }
  }

  @Test
  void aNewPrefixGetsItsTablesAndTheNextTrajectories() throws Exception {
    Subscription applied = nats.subscribe(Subjects.CONFIG_APPLIED);
    var key = Optional.of(CredentialSealing.fromBase64(CredentialSealingTest.randomKey()));
    startStore(key);
    ConfigApplied startup = nextApplied(applied);
    assertTrue(startup.getOk());
    assertEquals(0, startup.getConfigVersion());
    assertEquals("", startup.getStore().getTablePrefix());
    int oldLaunches = count("launches", null);

    ConfigApplied a = set(applied, 1, "demo_", new byte[0]);
    assertTrue(a.getOk(), a.getError());
    assertEquals(1, a.getConfigVersion());
    assertEquals("demo_", a.getStore().getTablePrefix());
    assertTrue(tableExists("demo_launches") && tableExists("demo_trajectory_samples"));
    assertTrue(tableExists("demo_flyway_schema_history"));

    TrajectoryComputed t = Trajectories.valid(10);
    storeOne(t);
    assertEquals(1, count("demo_launches", t.getLaunchId()));
    assertEquals(10, count("demo_trajectory_samples", t.getLaunchId()));
    assertEquals(oldLaunches, count("launches", null), "the old tables are unchanged");

    // the version rule
    ConfigApplied stale = set(applied, 0, "other_", new byte[0]);
    assertFalse(stale.getOk());
    assertEquals("stale version", stale.getError());
    assertEquals(1, stale.getConfigVersion());
    assertEquals("demo_", stale.getStore().getTablePrefix());
    ConfigApplied same = set(applied, 1, "other_", new byte[0]);
    assertTrue(same.getOk());
    assertEquals("demo_", same.getStore().getTablePrefix(), "nothing changes");
    assertFalse(tableExists("other_launches"));

    ConfigApplied invalid = set(applied, 2, "Not-A-Prefix", new byte[0]);
    assertFalse(invalid.getOk());
    assertEquals(1, invalid.getConfigVersion());
    String text = logs.toString(StandardCharsets.UTF_8);
    assertTrue(
        text.contains(
            "\"msg\":\"config set\",\"config_version\":\"1\",\"ok\":\"true\",\"table_prefix\":\"demo_\""),
        text);
  }

  @Test
  void sealedCredentialsSwitchTheWriterOnlyWhenTheyWork() throws Exception {
    Subscription applied = nats.subscribe(Subjects.CONFIG_APPLIED);
    var sealing = CredentialSealing.fromBase64(CredentialSealingTest.randomKey());
    startStore(Optional.of(sealing));
    nextApplied(applied);
    storeOne(Trajectories.valid(3));
    assertEquals(List.of(postgres.getUsername()), storeUsers());

    ConfigApplied ok =
        set(applied, 1, "cred_", sealing.seal(new DbCredentials(WRITER, WRITER_PASSWORD)));
    assertTrue(ok.getOk(), ok.getError());
    TrajectoryComputed t = Trajectories.valid(5);
    storeOne(t);
    assertEquals(1, count("cred_launches", t.getLaunchId()));
    assertEquals(List.of(WRITER), storeUsers(), "written by the new user");

    ConfigApplied wrongPassword =
        set(applied, 2, "cred_", sealing.seal(new DbCredentials(WRITER, "not-the-password")));
    assertFalse(wrongPassword.getOk());
    assertTrue(
        wrongPassword.getError().startsWith("cannot connect with the new credentials"),
        wrongPassword.getError());
    assertFalse(wrongPassword.getError().contains("not-the-password"));
    var otherKey = CredentialSealing.fromBase64(CredentialSealingTest.randomKey());
    ConfigApplied wrongKey =
        set(applied, 2, "cred_", otherKey.seal(new DbCredentials(WRITER, WRITER_PASSWORD)));
    assertFalse(wrongKey.getOk());
    assertEquals("cannot decrypt the credentials", wrongKey.getError());
    assertEquals(1, wrongKey.getConfigVersion());

    TrajectoryComputed after = Trajectories.valid(4);
    storeOne(after);
    assertEquals(1, count("cred_launches", after.getLaunchId()));
    assertEquals(List.of(WRITER), storeUsers(), "still the user in force");

    String file = Files.readString(dir.resolve("config.json"));
    assertTrue(file.contains("\"db_credentials_sealed\":"), file);
    assertNoPasswordAnywhere();
  }

  @Test
  void aRestartUsesThePrefixAndTheCredentialsOfTheFile() throws Exception {
    Subscription applied = nats.subscribe(Subjects.CONFIG_APPLIED);
    var sealing = CredentialSealing.fromBase64(CredentialSealingTest.randomKey());
    StoreService first = startStore(Optional.of(sealing));
    nextApplied(applied);
    ConfigApplied a =
        set(applied, 7, "restart_", sealing.seal(new DbCredentials(WRITER, WRITER_PASSWORD)));
    assertTrue(a.getOk(), a.getError());
    first.close();

    startStore(Optional.of(sealing));
    ConfigApplied startup = nextApplied(applied);
    assertTrue(startup.getOk());
    assertEquals(7, startup.getConfigVersion());
    assertEquals("restart_", startup.getStore().getTablePrefix());

    TrajectoryComputed t = Trajectories.valid(6);
    storeOne(t);
    assertEquals(1, count("restart_launches", t.getLaunchId()));
    assertEquals(List.of(WRITER), storeUsers());

    Subscription status = nats.subscribe(Subjects.STATUS);
    ServiceStatus beat = ServiceStatus.parseFrom(status.nextMessage(WAIT).getData());
    assertEquals(7, beat.getConfigVersion());
    assertEquals(ServiceStatus.State.STATE_OK, beat.getState(), beat.getDetail());
    assertNoPasswordAnywhere();
  }

  @Test
  void withoutAKeyCredentialsAreRefusedPrefixesAppliedAndTheStoreIsDegraded() throws Exception {
    Subscription applied = nats.subscribe(Subjects.CONFIG_APPLIED);
    startStore(Optional.empty());
    nextApplied(applied);
    var sealing = CredentialSealing.fromBase64(CredentialSealingTest.randomKey());
    ConfigApplied refused =
        set(applied, 1, "nokey_", sealing.seal(new DbCredentials(WRITER, WRITER_PASSWORD)));
    assertFalse(refused.getOk());
    assertEquals("no config key", refused.getError());
    assertFalse(tableExists("nokey_launches"));
    ConfigApplied prefixOnly = set(applied, 1, "nokey_", new byte[0]);
    assertTrue(prefixOnly.getOk(), prefixOnly.getError());
    assertTrue(tableExists("nokey_launches"));

    Subscription status = nats.subscribe(Subjects.STATUS);
    ServiceStatus beat = ServiceStatus.parseFrom(status.nextMessage(WAIT).getData());
    assertEquals(ServiceStatus.State.STATE_DEGRADED, beat.getState());
    assertEquals("STORE_CONFIG_KEY missing or invalid", beat.getDetail());
  }

  @Test
  void aCorruptFileStartsWithTheDefaultsDegradedUntilASetIsApplied() throws Exception {
    Files.writeString(dir.resolve("config.json"), "{\"config_version\": \"corrupt-content\"");
    Subscription applied = nats.subscribe(Subjects.CONFIG_APPLIED);
    StoreService store =
        startStore(Optional.of(CredentialSealing.fromBase64(CredentialSealingTest.randomKey())));
    ConfigApplied startup = nextApplied(applied);
    assertEquals(0, startup.getConfigVersion());
    assertEquals(Health.DEGRADED, store.health());
    assertEquals("local config file invalid", store.report().detail());
    assertFalse(logs.toString(StandardCharsets.UTF_8).contains("corrupt-content"));

    assertTrue(set(applied, 1, "", new byte[0]).getOk());
    assertEquals(Health.OK, store.health(), store.report().detail());
  }
}
