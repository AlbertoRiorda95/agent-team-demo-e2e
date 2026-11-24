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
 * The store: reads its local config file, applies the migrations of the prefix in force, connects
 * to NATS, starts the {@code status.store} heartbeat, answers {@code config.store.set}, publishes
 * the {@code ConfigApplied} of the config in force, creates the durable consumer and pulls {@code
 * trajectories.computed}. Each start-up step is
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
  private volatile Connection nats;
  private ApplyStoreConfig configs;
  private ConfigListener configListener;
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
    configs = new ApplyStoreConfig(loadConfig(), config.sealing(), new ConfigPorts());
    health.configKey(config.sealing().isPresent());
    if (config.sealing().isEmpty()) {
      log.warn(
          "no config key: sets with credentials are refused",
          Map.of("error", config.configKeyProblem(), "health", "degraded"));
    }
    migrate();
    connectNats();
    String instance = instanceName();
    heartbeat =
        new Heartbeat(
            nats, health, () -> configs.inForce().version(), instance, version(), log,
            heartbeatInterval);
    heartbeat.start();
    configListener = new ConfigListener(nats, configs, health, log, instance);
    configListener.start();
    configListener.answer(true, "", configs.inForce());
    repository = new PostgresTrajectoryRepository(this::openDatabase);
    consumer =
        new TrajectoryConsumer(
            nats, new StoreTrajectory(repository, configs::inForce), health, log, sleeper);
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

  /** The config in force, for the tests. */
  ConfigInForce configInForce() {
    return configs.inForce();
  }

  /**
   * The config of the local file; the defaults (version 0, no prefix, the environment
   * credentials) when there is none, or when it cannot be used (logged without its content,
   * degraded until a set is applied).
   */
  ConfigInForce loadConfig() {
    ConfigInForce defaults = ConfigInForce.defaults(config.environmentCredentials());
    LocalConfigFile file = new LocalConfigFile(config.configPath());
    String problem;
    try {
      var content = file.load();
      if (content.isEmpty()) {
        log.info("no local config file: defaults", Map.of("path", file.path().toString()));
        return defaults;
      }
      LocalConfigFile.Content c = content.get();
      byte[] sealed = c.sealedCredentials();
      DbCredentials credentials = config.environmentCredentials();
      if (sealed.length > 0) {
        if (config.sealing().isEmpty()) {
          throw new CredentialSealing.SealingException(ApplyStoreConfig.NO_CONFIG_KEY);
        }
        credentials = config.sealing().get().open(sealed);
      }
      log.info(
          "local config file read",
          Map.of(
              "path", file.path().toString(),
              "config_version", String.valueOf(c.version()),
              "table_prefix", c.prefix().value(),
              "credentials", sealed.length > 0 ? "sealed" : "environment"));
      return new ConfigInForce(c.version(), c.prefix(), sealed, credentials);
    } catch (java.io.IOException e) {
      problem = "unreadable: " + e.getClass().getSimpleName();
    } catch (LocalConfigFile.InvalidFileException | CredentialSealing.SealingException e) {
      problem = e.getMessage(); // what is wrong, never the content
    }
    health.configFile(false);
    log.error(
        "local config file not used: defaults",
        Map.of("path", file.path().toString(), "error", problem, "health", "degraded"));
    return defaults;
  }

  void migrate() throws InterruptedException {
    ConfigInForce inForce = configs.inForce();
    TablePrefix p = inForce.prefix();
    var result =
        retry(
            "cannot apply the database migrations",
            () -> Migrations.migrate(config, p, inForce.credentials()));
    health.database(true);
    log.info(
        "database migrated",
        Map.of(
            "table_prefix", p.value(),
            "schema_version", String.valueOf(result.targetSchemaVersion),
            "applied", String.valueOf(result.migrationsExecuted)));
  }

  /** The database and the file, as the config use case needs them. */
  private final class ConfigPorts implements ApplyStoreConfig.Ports {
    @Override
    public void migrate(TablePrefix prefix, DbCredentials credentials) {
      var result = Migrations.migrate(config, prefix, credentials);
      log.info(
          "database migrated",
          Map.of(
              "table_prefix", prefix.value(),
              "schema_version", String.valueOf(result.targetSchemaVersion),
              "applied", String.valueOf(result.migrationsExecuted)));
    }

    @Override
    public void testConnection(DbCredentials credentials) throws java.sql.SQLException {
      try (java.sql.Connection c = openDatabase(credentials)) {
        if (!c.isValid(Integer.parseInt(DB_CONNECT_TIMEOUT_S))) {
          throw new java.sql.SQLException("the test connection is not valid");
        }
      }
    }

    @Override
    public void save(LocalConfigFile.Content content) throws java.io.IOException {
      new LocalConfigFile(config.configPath()).save(content);
    }
  }

  /** A connection as {@code credentials}. */
  private java.sql.Connection openDatabase(DbCredentials credentials)
      throws java.sql.SQLException {
    Properties props = new Properties();
    props.setProperty("user", credentials.user());
    props.setProperty("password", credentials.password());
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

  /**
   * Stops the config subscription, the consumer (the message in progress finishes), the
   * heartbeat, then NATS.
   */
  @Override
  public void close() {
    if (configListener != null) {
      configListener.close();
    }
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
