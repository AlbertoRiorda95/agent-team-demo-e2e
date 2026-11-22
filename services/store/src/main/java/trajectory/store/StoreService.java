package trajectory.store;

import io.nats.client.Connection;
import io.nats.client.ConnectionListener;
import io.nats.client.Nats;
import io.nats.client.Options;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Start-up of the store: applies the migrations, then connects to NATS. Each step is retried with
 * {@link Backoff} until it succeeds; a failure is logged with {@code "health":"degraded"}, never
 * thrown.
 */
public final class StoreService implements AutoCloseable {
  /** Waits between two attempts ({@code Thread::sleep} in the service). */
  @FunctionalInterface
  public interface Sleeper {
    /** Sleeps for {@code delay}. */
    void sleep(Duration delay) throws InterruptedException;
  }

  private static final Duration NATS_CONNECT_TIMEOUT = Duration.ofSeconds(2);

  private final StoreConfig config;
  private final JsonLog log;
  private final Sleeper sleeper;
  private final AtomicBoolean migrated = new AtomicBoolean();
  private final AtomicBoolean natsUp = new AtomicBoolean();
  private volatile Connection nats;

  /**
   * Creates the service; nothing is contacted before {@link #start()}.
   *
   * @param config the validated configuration
   * @param log where the start-up is logged
   * @param sleeper waits between attempts
   */
  public StoreService(StoreConfig config, JsonLog log, Sleeper sleeper) {
    this.config = config;
    this.log = log;
    this.sleeper = sleeper;
  }

  /**
   * Migrates the database, then connects to NATS, retrying each until it succeeds.
   *
   * @throws InterruptedException when stopped while retrying
   */
  public void start() throws InterruptedException {
    migrate();
    connectNats();
  }

  /** {@code ok} once migrated and connected to NATS. */
  public Health health() {
    return migrated.get() && natsUp.get() ? Health.OK : Health.DEGRADED;
  }

  void migrate() throws InterruptedException {
    var result =
        retry("cannot apply the database migrations", () -> Migrations.migrate(config));
    migrated.set(true);
    log.info(
        "database migrated",
        Map.of(
            "schema_version", String.valueOf(result.targetSchemaVersion),
            "applied", String.valueOf(result.migrationsExecuted)));
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
    natsUp.set(true);
    log.info(
        "connected to NATS",
        Map.of("nats_url", StoreConfig.redact(config.natsUrl()), "health", health().toString()));
  }

  private void onNatsEvent(Connection conn, ConnectionListener.Events event) {
    switch (event) {
      case CONNECTED, RECONNECTED -> natsUp.set(true);
      case DISCONNECTED, CLOSED -> {
        natsUp.set(false);
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

  /** Closes the NATS connection, if any. */
  @Override
  public void close() {
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
