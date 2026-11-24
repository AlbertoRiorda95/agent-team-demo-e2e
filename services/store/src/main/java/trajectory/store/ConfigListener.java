package trajectory.store;

import com.google.protobuf.Timestamp;
import io.nats.client.Connection;
import io.nats.client.Dispatcher;
import io.nats.client.Message;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import trajectory.v1.Config.ConfigApplied;
import trajectory.v1.Config.StoreConfig;

/**
 * The NATS adapter of {@link ApplyStoreConfig}: a subscription of this instance to {@code
 * config.store.set} (new messages only), each answered with a {@code ConfigApplied} on {@code
 * config.store.applied}. The answer carries the config in force with an always empty {@code
 * db_credentials_sealed} (write-only). One log line per set: version, ok, prefix, error.
 */
public final class ConfigListener implements AutoCloseable {
  private static final java.time.Duration FLUSH_TIMEOUT = java.time.Duration.ofSeconds(2);

  private final Connection nats;
  private final ApplyStoreConfig useCase;
  private final ServiceHealth health;
  private final JsonLog log;
  private final String instance;
  private Dispatcher dispatcher;

  /**
   * Creates the listener; nothing is received before {@link #start()}.
   *
   * @param nats a connected NATS connection
   * @param useCase what each set goes through
   * @param health the config file is valid again once a set is applied
   * @param log one line per set
   * @param instance host or pod name
   */
  public ConfigListener(
      Connection nats, ApplyStoreConfig useCase, ServiceHealth health, JsonLog log,
      String instance) {
    this.nats = nats;
    this.useCase = useCase;
    this.health = health;
    this.log = log;
    this.instance = instance;
  }

  /** Subscribes to {@code config.store.set}; the sets are handled one at a time. */
  public synchronized void start() {
    if (dispatcher != null) {
      return;
    }
    dispatcher = nats.createDispatcher(this::onSet);
    dispatcher.subscribe(Subjects.CONFIG_SET);
    try {
      nats.flush(FLUSH_TIMEOUT); // the subscription is on the server before start() returns
    } catch (java.util.concurrent.TimeoutException | InterruptedException e) {
      if (e instanceof InterruptedException) {
        Thread.currentThread().interrupt();
      }
      log.warn("config subscription not confirmed yet", Map.of("error", e.getClass().getSimpleName()));
    }
  }

  private void onSet(Message msg) {
    ApplyStoreConfig.Result result = useCase.handle(msg.getData());
    if (result.changed()) {
      health.configFile(true);
    }
    Map<String, String> fields = new LinkedHashMap<>();
    fields.put("config_version", String.valueOf(result.inForce().version()));
    fields.put("ok", String.valueOf(result.ok()));
    fields.put("table_prefix", result.inForce().prefix().value());
    fields.put("changed", String.valueOf(result.changed()));
    if (!result.ok()) {
      fields.put("error", result.error());
      log.warn("config set", fields);
    } else {
      log.info("config set", fields);
    }
    answer(result.ok(), result.error(), result.inForce());
  }

  /**
   * Publishes a {@code ConfigApplied} of the config in force (also at start-up).
   *
   * @param ok whether the set was applied
   * @param error why not, empty when ok
   * @param inForce the config in force
   */
  public void answer(boolean ok, String error, ConfigInForce inForce) {
    try {
      // core NATS: the CONFIG stream keeps the latest; no Nats-Msg-Id (proto/README.md)
      nats.publish(Subjects.CONFIG_APPLIED, applied(ok, error, inForce, instance, Instant.now())
          .toByteArray());
    } catch (RuntimeException e) {
      log.warn("cannot answer the config set", Map.of("error", String.valueOf(e.getMessage())));
    }
  }

  /** The answer: the config in force, never its credentials. */
  static ConfigApplied applied(
      boolean ok, String error, ConfigInForce inForce, String instance, Instant now) {
    return ConfigApplied.newBuilder()
        .setService(Subjects.SERVICE)
        .setInstance(instance)
        .setConfigVersion(inForce.version())
        .setOk(ok)
        .setError(error)
        .setAppliedAt(
            Timestamp.newBuilder().setSeconds(now.getEpochSecond()).setNanos(now.getNano()))
        // db_credentials_sealed left empty: write-only
        .setStore(StoreConfig.newBuilder().setTablePrefix(inForce.prefix().value()))
        .build();
  }

  /** Unsubscribes; a set being handled finishes first. */
  @Override
  public synchronized void close() {
    if (dispatcher != null) {
      nats.closeDispatcher(dispatcher);
      dispatcher = null;
    }
  }
}
