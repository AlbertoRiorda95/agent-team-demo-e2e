package trajectory.store;

import io.nats.client.Connection;
import io.nats.client.ConnectionListener;
import io.nats.client.Nats;
import io.nats.client.Options;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.Callable;

/**
 * The store: applies the migrations, connects to NATS, starts the {@code status.store} heartbeat,
 * creates the durable consumer and pulls {@code trajectories.computed}. Each start-up step is
 * retried with {@link Backoff} until it succeeds; a failure is logged with {@code
 * "health":"degraded"}, never thrown.
 */
public final class StoreService implements AutoCloseable {
  /** Waits between two attempts ({@code Thread::sleep} in the service). */
  @FunctionalInterface
  public interface Sleeper {
    /** Sleeps for {@code delay}. */
    void sleep(Duration delay) throws InterruptedException;
  }

  private static final Duration NATS_CONNECT_TIMEOUT = Duration.ofSeconds(2);
  private static final String DB_CONNECT_TIMEOUT_S = "5";

  private final StoreConfig config;
  private final JsonLog log;
  private final Sleeper sleeper;
  private final ServiceHealth health = new ServiceHealth();
  private final Duration heartbeatInterval;
  private volatile TablePrefix prefix = TablePrefix.NONE;
  private volatile Connection nats;
  private Heartbeat heartbeat;
  private TrajectoryConsumer consumer;
  private PostgresTrajectoryRepository repository;

  /**
   * Creates the service; nothing is contacted before {@link #start()}.
   *
   * @param config the validated configuration
   * @param log where the start-up is logged
   * @param sleeper waits between attempts
   */
  public StoreService(StoreConfig config, JsonLog log, Sleeper sleeper) {
    this(config, log, sleeper, Heartbeat.INTERVAL);
  }

  /** As {@link #StoreService(StoreConfig, JsonLog, Sleeper)}, with another heartbeat interval. */
  StoreService(StoreConfig config, JsonLog log, Sleeper sleeper, Duration heartbeatInterval) {
    this.config = config;
    this.log = log;
    this.sleeper = sleeper;
    this.heartbeatInterval = heartbeatInterval;
  }

  /**
   * Migrates the database, connects to NATS, starts the heartbeat, creates the durable consumer
   * (retrying each step until it succeeds), then pulls the trajectories on a thread of its own.
   *
   * @throws InterruptedException when stopped while retrying
   */
  public void start() throws InterruptedException {
    migrate();
    connectNats();
    heartbeat =
        new Heartbeat(
            nats, health, () -> 0L, instanceName(), version(), log, heartbeatInterval);
    heartbeat.start();
    repository = new PostgresTrajectoryRepository(this::openDatabase);
    consumer =
        new TrajectoryConsumer(
            nats, new StoreTrajectory(repository, () -> prefix), health, log, sleeper);
    retry(
        "cannot create the durable consumer",
        () -> {
          try {
            consumer.ensureConsumer();
            return null;
          } catch (Exception e) {
            health.consumer(false);
            throw e;
          }
        });
    log.info("consumer ready", Map.of("durable", Subjects.DURABLE));
    consumer.start();
  }

  /** {@code ok} when the database, NATS and the durable consumer are up. */
  public Health health() {
    return health.report().health();
  }

  /** The health with its reasons, as the heartbeat sends it. */
  ServiceHealth.Report report() {
    return health.report();
  }

  void migrate() throws InterruptedException {
    TablePrefix p = prefix;
    var result =
        retry("cannot apply the database migrations", () -> Migrations.migrate(config, p));
    health.database(true);
    log.info(
        "database migrated",
        Map.of(
            "table_prefix", p.value(),
            "schema_version", String.valueOf(result.targetSchemaVersion),
            "applied", String.valueOf(result.migrationsExecuted)));
  }

  /** A connection with the credentials of the environment (task 3 adds the sealed ones). */
  private java.sql.Connection openDatabase() throws java.sql.SQLException {
    Properties props = new Properties();
    props.setProperty("user", config.databaseUser());
    props.setProperty("password", config.databasePassword());
    props.setProperty("connectTimeout", DB_CONNECT_TIMEOUT_S);
    props.setProperty("ApplicationName", "store");
    return DriverManager.getConnection(config.jdbcUrl(), props);
  }

  /** {@code HOSTNAME} (the pod or container name), else the host name. */
  static String instanceName() {
    String host = System.getenv("HOSTNAME");
    if (host != null && !host.isBlank()) {
      return host;
    }
    try {
      return InetAddress.getLocalHost().getHostName();
    } catch (UnknownHostException e) {
      return "store";
    }
  }

  /** The version in the jar manifest ({@code build.gradle.kts}), {@code dev} when run from classes. */
  static String version() {
    String v = StoreService.class.getPackage().getImplementationVersion();
    return v == null ? "dev" : v;
  }

  void connectNats() throws InterruptedException {
    Options options =
        Options.builder()
            .server(config.natsUrl())
            .connectionName("store")
            .connectionTimeout(NATS_CONNECT_TIMEOUT)
            .maxReconnects(-1) // once connected, reconnect forever on its own
            .connectionListener(this::onNatsEvent)
            .build();
    nats = retry("cannot connect to NATS", () -> Nats.connect(options));
    health.nats(true);
    log.info(
        "connected to NATS",
        Map.of("nats_url", StoreConfig.redact(config.natsUrl()), "health", health().toString()));
  }

  private void onNatsEvent(Connection conn, ConnectionListener.Events event) {
    switch (event) {
      case CONNECTED, RECONNECTED -> health.nats(true);
      case DISCONNECTED, CLOSED -> {
        health.nats(false);
        log.warn("NATS connection lost", Map.of("event", event.name(), "health", "degraded"));
      }
      default -> {
        // other events (discovered servers, lame duck...) do not change the health
      }
    }
  }

  private <T> T retry(String failure, Callable<T> action) throws InterruptedException {
    for (int attempt = 1; ; attempt++) {
      try {
        return action.call();
      } catch (InterruptedException e) {
        throw e;
      } catch (Exception e) {
        Duration delay = Backoff.delay(attempt);
        log.error(
            failure,
            Map.of(
                "error", describe(e),
                "health", "degraded",
                "attempt", String.valueOf(attempt),
                "retry_in_ms", String.valueOf(delay.toMillis())));
        sleeper.sleep(delay);
      }
    }
  }

  /**
   * The first line of the error (Flyway's messages add a multi-line report), with the NATS URL
   * redacted in case the client echoes it with its credentials.
   */
  String describe(Exception e) {
    String msg = e.getMessage() == null ? e.getClass().getName() : e.getMessage();
    int end = msg.indexOf('\n');
    String line = end < 0 ? msg : msg.substring(0, end);
    return line.replace(config.natsUrl(), StoreConfig.redact(config.natsUrl()));
  }

  /** Stops the consumer (the message in progress finishes), the heartbeat, then NATS. */
  @Override
  public void close() {
    if (consumer != null) {
      consumer.close();
    }
    if (heartbeat != null) {
      heartbeat.close();
    }
    if (repository != null) {
      repository.close();
    }
    Connection conn = nats;
    if (conn != null) {
      try {
        conn.close();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
  }
}
