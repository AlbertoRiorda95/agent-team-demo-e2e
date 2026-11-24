package trajectory.store;

import com.google.protobuf.Timestamp;
import io.nats.client.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import trajectory.v1.Service.ServiceStatus;

/**
 * The {@code status.store} heartbeat: a {@code trajectory.v1.ServiceStatus} every 5 s on core
 * NATS, on a fixed schedule. Nothing is sent while NATS is not connected.
 */
public final class Heartbeat implements AutoCloseable {
  /** The interval of the beats. */
  public static final Duration INTERVAL = Duration.ofSeconds(5);

  private final Connection nats;
  private final ServiceHealth health;
  private final LongSupplier configVersion;
  private final String instance;
  private final String version;
  private final JsonLog log;
  private final Duration interval;
  private ScheduledExecutorService scheduler;

  /**
   * Creates the heartbeat; nothing is sent before {@link #start()}.
   *
   * @param nats the connection to send on
   * @param health read at every beat
   * @param configVersion the config version in force, read at every beat
   * @param instance host or pod name
   * @param version the version of the store
   * @param log where a failed beat is logged
   * @param interval {@link #INTERVAL} in the service
   */
  public Heartbeat(
      Connection nats,
      ServiceHealth health,
      LongSupplier configVersion,
      String instance,
      String version,
      JsonLog log,
      Duration interval) {
    this.nats = nats;
    this.health = health;
    this.configVersion = configVersion;
    this.instance = instance;
    this.version = version;
    this.log = log;
    this.interval = interval;
  }

  /** Starts the beats, the first one now. */
  public synchronized void start() {
    if (scheduler != null) {
      return;
    }
    scheduler =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, "store-heartbeat");
              t.setDaemon(true);
              return t;
            });
    scheduler.scheduleAtFixedRate(this::beat, 0, interval.toMillis(), TimeUnit.MILLISECONDS);
  }

  /** The status message of this instance now. */
  ServiceStatus message(Instant now) {
    ServiceHealth.Report report = health.report();
    return ServiceStatus.newBuilder()
        .setService(Subjects.SERVICE)
        .setInstance(instance)
        .setState(
            report.health() == Health.OK
                ? ServiceStatus.State.STATE_OK
                : ServiceStatus.State.STATE_DEGRADED)
        .setDetail(report.detail())
        .setVersion(version)
        .setConfigVersion(configVersion.getAsLong())
        .setSentAt(
            Timestamp.newBuilder().setSeconds(now.getEpochSecond()).setNanos(now.getNano()))
        .build();
  }

  private void beat() {
    if (nats.getStatus() != Connection.Status.CONNECTED) {
      return;
    }
    try {
      nats.publish(Subjects.STATUS, message(Instant.now()).toByteArray());
    } catch (RuntimeException e) {
      // never let an exception cancel the schedule
      log.warn("cannot send the heartbeat", Map.of("error", String.valueOf(e.getMessage())));
    }
  }

  /** Stops the beats. */
  @Override
  public synchronized void close() {
    if (scheduler != null) {
      scheduler.shutdownNow();
      scheduler = null;
    }
  }
}
