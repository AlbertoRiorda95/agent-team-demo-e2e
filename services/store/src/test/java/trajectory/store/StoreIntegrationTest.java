package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.nats.client.Connection;
import io.nats.client.JetStreamApiException;
import io.nats.client.Message;
import io.nats.client.Nats;
import io.nats.client.PublishOptions;
import io.nats.client.Subscription;
import io.nats.client.api.ConsumerInfo;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import trajectory.v1.Service.PipelineError;
import trajectory.v1.Service.ServiceStatus;
import trajectory.v1.Trajectory.Sample;
import trajectory.v1.Trajectory.TrajectoryComputed;
import trajectory.v1.Trajectory.TrajectoryStored;

/**
 * Integration: the store's message handling against PostgreSQL 17 and NATS in Testcontainers (the
 * repository's NATS config and streams). One store for the whole class, as in compose.
 */
class StoreIntegrationTest {
  private static final Duration WAIT = Duration.ofSeconds(15);

  private static PostgreSQLContainer postgres;
  private static GenericContainer<?> natsServer;
  private static Connection nats;
  private static StoreService store;
  private static final ByteArrayOutputStream LOGS = new ByteArrayOutputStream();

  @BeforeAll
  static void start() throws Exception {
    postgres = TestInfra.postgres();
    natsServer = TestInfra.nats();
    postgres.start();
    natsServer.start();
    TestInfra.createStreams(natsServer);
    nats = Nats.connect(TestInfra.natsUrl(natsServer));
    store =
        new StoreService(
            TestInfra.config(postgres, natsServer),
            new JsonLog(new PrintStream(LOGS, true, StandardCharsets.UTF_8)),
            Thread::sleep);
    store.start();
  }

  @AfterAll
  static void stop() throws InterruptedException {
    if (store != null) {
      store.close();
    }
    if (nats != null) {
      nats.close();
    }
    natsServer.stop();
    postgres.stop();
  }

  private static void publish(TrajectoryComputed t, boolean withMsgId)
      throws IOException, JetStreamApiException {
    PublishOptions options =
        withMsgId ? PublishOptions.builder().messageId(t.getLaunchId()).build() : null;
    nats.jetStream().publish(Subjects.TRAJECTORIES_COMPUTED, t.toByteArray(), options);
  }

  private static java.sql.Connection db() throws SQLException {
    return DriverManager.getConnection(
        postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
  }

  private static int count(String sql, String launchId) throws SQLException {
    try (var conn = db();
        var ps = conn.prepareStatement(sql)) {
      if (launchId != null) {
        ps.setObject(1, UUID.fromString(launchId));
      }
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getInt(1);
      }
    }
  }

  private static ConsumerInfo consumer() throws IOException, JetStreamApiException {
    return nats.jetStreamManagement()
        .getConsumerInfo(Subjects.TRAJECTORIES_STREAM, Subjects.DURABLE);
  }

  /** Waits until the consumer has nothing pending nor unacked: every message was acked or termed. */
  private static ConsumerInfo awaitSettled() throws Exception {
    long deadline = System.nanoTime() + WAIT.toNanos();
    while (true) {
      ConsumerInfo info = consumer();
      if (info.getNumPending() == 0 && info.getNumAckPending() == 0) {
        return info;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("consumer not settled: " + info);
      }
      Thread.sleep(100);
    }
  }

  private static TrajectoryStored nextStored(Subscription sub, String launchId) throws Exception {
    Message m = sub.nextMessage(WAIT);
    assertNotNull(m, "no TrajectoryStored; logs: " + LOGS.toString(StandardCharsets.UTF_8));
    assertEquals(launchId, m.getHeaders().getFirst("Nats-Msg-Id"));
    TrajectoryStored stored = TrajectoryStored.parseFrom(m.getData());
    assertEquals(launchId, stored.getLaunchId());
    return stored;
  }

  @Test
  void storesTheLaunchAndEverySampleThenConfirms() throws Exception {
    TrajectoryComputed t = Trajectories.valid(6001);
    Subscription stored = nats.subscribe(Subjects.TRAJECTORIES_STORED);
    publish(t, true);

    TrajectoryStored confirmation = nextStored(stored, t.getLaunchId());
    assertEquals(6001, confirmation.getSampleCount());
    assertTrue(confirmation.getStoredAt().getSeconds() > 0);
    awaitSettled();
    assertEquals(0, consumer().getRedelivered(), "acked, never redelivered");

    try (var conn = db();
        var ps = conn.prepareStatement("SELECT * FROM launches WHERE id = ?")) {
      ps.setObject(1, UUID.fromString(t.getLaunchId()));
      try (ResultSet rs = ps.executeQuery()) {
        assertTrue(rs.next());
        assertEquals(TrajectoryRows.timestamp(t.getAcceptedAt()), utc(rs, "received_at"));
        assertEquals(TrajectoryRows.timestamp(t.getComputedAt()), utc(rs, "computed_at"));
        assertEquals(
            confirmation.getStoredAt().getSeconds(), utc(rs, "stored_at").toEpochSecond());
        var r = t.getRequest();
        assertEquals(r.getMassKg(), rs.getDouble("mass_kg"));
        assertEquals(r.getPosition().getXM(), rs.getDouble("x_m"));
        assertEquals(r.getPosition().getYM(), rs.getDouble("y_m"));
        assertEquals(r.getPosition().getZM(), rs.getDouble("z_m"));
        assertEquals(r.getAzimuthDeg(), rs.getDouble("azimuth_deg"));
        assertEquals(r.getElevationDeg(), rs.getDouble("elevation_deg"));
        assertEquals(r.getForceN(), rs.getDouble("force_n"));
        assertEquals(r.getBurnDurationS(), rs.getDouble("burn_duration_s"));
        var c = t.getConfig();
        assertEquals(c.getPropagationTimeS(), rs.getDouble("propagation_time_s"));
        assertEquals(c.getSampleStepS(), rs.getDouble("sample_step_s"));
        assertEquals(c.getGravityMps2(), rs.getDouble("gravity_mps2"));
        assertEquals(c.getConfigVersion(), rs.getLong("config_version"));
        assertEquals("stored", rs.getString("status"));
        assertEquals("ground", rs.getString("end_reason"));
        assertEquals(t.getFlightTimeS(), rs.getDouble("flight_time_s"));
        assertEquals(t.getMaxHeightM(), rs.getDouble("max_height_m"));
        assertEquals(t.getRangeM(), rs.getDouble("range_m"));
        assertEquals(6001, rs.getInt("sample_count"));
      }
    }

    try (var conn = db();
        var ps =
            conn.prepareStatement(
                "SELECT * FROM trajectory_samples WHERE launch_id = ? ORDER BY seq")) {
      ps.setObject(1, UUID.fromString(t.getLaunchId()));
      try (ResultSet rs = ps.executeQuery()) {
        int n = 0;
        while (rs.next()) {
          Sample s = t.getSamples(n);
          assertEquals(n, rs.getInt("seq"));
          // exact: COPY text and float8 output both round-trip a double
          assertEquals(s.getTS(), rs.getDouble("t_s"), "t_s of " + n);
          assertEquals(s.getXM(), rs.getDouble("x_m"));
          assertEquals(s.getYM(), rs.getDouble("y_m"));
          assertEquals(s.getZM(), rs.getDouble("z_m"));
          assertEquals(s.getVxMps(), rs.getDouble("vx_mps"));
          assertEquals(s.getVyMps(), rs.getDouble("vy_mps"));
          assertEquals(s.getVzMps(), rs.getDouble("vz_mps"));
          assertEquals(TrajectoryRows.phase(s.getPhase()), rs.getString("phase"));
          n++;
        }
        assertEquals(6001, n);
      }
    }

    String logs = LOGS.toString(StandardCharsets.UTF_8);
    assertTrue(
        logs.contains(
            "\"msg\":\"trajectory\",\"launch_id\":\"" + t.getLaunchId()
                + "\",\"outcome\":\"stored\",\"samples\":\"6001\",\"duration_ms\":"),
        logs);
  }

  @Test
  void theSameMessageTwiceIsStoredOnceAndConfirmedTwice() throws Exception {
    TrajectoryComputed t = Trajectories.valid(6001);
    Subscription stored = nats.subscribe(Subjects.TRAJECTORIES_STORED);
    publish(t, true);
    TrajectoryStored first = nextStored(stored, t.getLaunchId());
    // a redelivery: no Nats-Msg-Id, so the stream keeps it and store sees it again
    publish(t, false);
    TrajectoryStored second = nextStored(stored, t.getLaunchId());
    awaitSettled();

    assertEquals(6001, second.getSampleCount());
    assertEquals(first.getStoredAt(), second.getStoredAt(), "the stored row, not a new one");
    assertEquals(1, count("SELECT count(*) FROM launches WHERE id = ?", t.getLaunchId()));
    assertEquals(
        6001, count("SELECT count(*) FROM trajectory_samples WHERE launch_id = ?", t.getLaunchId()));
    assertTrue(
        LOGS.toString(StandardCharsets.UTF_8)
            .contains("\"launch_id\":\"" + t.getLaunchId() + "\",\"outcome\":\"duplicate\""));
  }

  @Test
  void anInvalidMessageIsReportedNotStoredNotRedelivered() throws Exception {
    Subscription errors = nats.subscribe(Subjects.PIPELINE_ERRORS);
    Subscription stored = nats.subscribe(Subjects.TRAJECTORIES_STORED);
    int launchesBefore = count("SELECT count(*) FROM launches", null);
    TrajectoryComputed noSamples = Trajectories.valid(3).toBuilder().clearSamples().build();
    publish(noSamples, true);

    Message m = errors.nextMessage(WAIT);
    assertNotNull(m, "no PipelineError");
    PipelineError error = PipelineError.parseFrom(m.getData());
    assertEquals(noSamples.getLaunchId(), error.getLaunchId());
    assertEquals("store", error.getService());
    assertEquals("trajectories.computed", error.getSubject());
    assertEquals("no samples", error.getMessage());
    assertTrue(error.getOccurredAt().getSeconds() > 0);

    nats.jetStream()
        .publish(Subjects.TRAJECTORIES_COMPUTED, "not protobuf".getBytes(StandardCharsets.UTF_8));
    PipelineError undecodable = PipelineError.parseFrom(errors.nextMessage(WAIT).getData());
    assertEquals("", undecodable.getLaunchId());

    awaitSettled();
    Thread.sleep(1000);
    assertEquals(0, consumer().getNumAckPending(), "terminated, not redelivered");
    assertEquals(launchesBefore, count("SELECT count(*) FROM launches", null));
    assertNull(stored.nextMessage(Duration.ofMillis(200)), "nothing confirmed");
  }

  @Test
  void theSampleCapIsStoredAndConfirmedWithinTenSeconds() throws Exception {
    TrajectoryComputed t = Trajectories.valid(100_000);
    Subscription stored = nats.subscribe(Subjects.TRAJECTORIES_STORED);
    long start = System.nanoTime();
    publish(t, true);
    TrajectoryStored confirmation = nextStored(stored, t.getLaunchId());
    Duration took = Duration.ofNanos(System.nanoTime() - start);
    assertEquals(100_000, confirmation.getSampleCount());
    assertTrue(took.compareTo(Duration.ofSeconds(10)) < 0, "took " + took);
    assertEquals(
        100_000,
        count("SELECT count(*) FROM trajectory_samples WHERE launch_id = ?", t.getLaunchId()));
  }

  @Test
  void aHeartbeatEveryFiveSeconds() throws Exception {
    Subscription status = nats.subscribe(Subjects.STATUS);
    List<Long> arrivals = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      Message m = status.nextMessage(Duration.ofSeconds(7));
      assertNotNull(m, "no heartbeat");
      arrivals.add(System.nanoTime());
      ServiceStatus s = ServiceStatus.parseFrom(m.getData());
      assertEquals("store", s.getService());
      assertEquals(ServiceStatus.State.STATE_OK, s.getState(), s.getDetail());
      assertEquals(0, s.getConfigVersion());
      assertTrue(!s.getInstance().isEmpty() && !s.getVersion().isEmpty());
    }
    for (int i = 1; i < arrivals.size(); i++) {
      long ms = (arrivals.get(i) - arrivals.get(i - 1)) / 1_000_000;
      assertTrue(ms >= 4000 && ms <= 6000, "interval " + ms + " ms");
    }
  }

  private static OffsetDateTime utc(ResultSet rs, String column) throws SQLException {
    return rs.getObject(column, OffsetDateTime.class).withOffsetSameInstant(ZoneOffset.UTC);
  }
}
