package trajectory.store;

import com.google.protobuf.Timestamp;
import io.nats.client.Connection;
import io.nats.client.ConsumerContext;
import io.nats.client.JetStreamApiException;
import io.nats.client.JetStreamStatusCheckedException;
import io.nats.client.Message;
import io.nats.client.PublishOptions;
import io.nats.client.api.AckPolicy;
import io.nats.client.api.ConsumerConfiguration;
import io.nats.client.api.DeliverPolicy;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import trajectory.v1.Service.PipelineError;
import trajectory.v1.Trajectory.TrajectoryStored;

/**
 * The NATS adapter of {@link StoreTrajectory}: pulls {@code trajectories.computed} from the durable
 * consumer {@code store}, one message at a time, and turns each outcome into NATS actions:
 *
 * <ul>
 *   <li>stored or duplicate: {@code TrajectoryStored} on JetStream ({@code Nats-Msg-Id} =
 *       launch_id), then ack;
 *   <li>rejected: term, {@code PipelineError};
 *   <li>database unavailable: nak with a 5 s delay, degraded, then a pause with {@link Backoff}.
 * </ul>
 *
 * It never stops on an error; only {@link #close()} stops it.
 */
public final class TrajectoryConsumer implements AutoCloseable {
  /** How long JetStream waits for an ack before redelivering. */
  public static final Duration ACK_WAIT = Duration.ofSeconds(60);
  /** The delay of a redelivery after a database failure. */
  public static final Duration NAK_DELAY = Duration.ofSeconds(5);

  private static final Duration PULL_WAIT = Duration.ofSeconds(1);

  private final Connection nats;
  private final StoreTrajectory useCase;
  private final ServiceHealth health;
  private final JsonLog log;
  private final StoreService.Sleeper sleeper;
  private volatile boolean running;
  private Thread thread;
  private ConsumerContext consumer;
  private int failures;

  /**
   * Creates the consumer; nothing is pulled before {@link #start()}.
   *
   * @param nats a connected NATS connection
   * @param useCase what each message goes through
   * @param health updated with the state of the database and of the consumer
   * @param log one line per trajectory
   * @param sleeper waits between retries
   */
  public TrajectoryConsumer(
      Connection nats,
      StoreTrajectory useCase,
      ServiceHealth health,
      JsonLog log,
      StoreService.Sleeper sleeper) {
    this.nats = nats;
    this.useCase = useCase;
    this.health = health;
    this.log = log;
    this.sleeper = sleeper;
  }

  /** The durable consumer as the store creates it (idempotent, shared by the replicas). */
  static ConsumerConfiguration configuration() {
    return ConsumerConfiguration.builder()
        .durable(Subjects.DURABLE)
        .filterSubject(Subjects.TRAJECTORIES_COMPUTED)
        .deliverPolicy(DeliverPolicy.All)
        .ackPolicy(AckPolicy.Explicit)
        .ackWait(ACK_WAIT)
        .maxDeliver(-1) // a message waits for the database as long as it takes
        .build();
  }

  /**
   * Creates (or updates) the durable consumer.
   *
   * @throws IOException or {@link JetStreamApiException} when NATS or the stream is missing
   */
  void ensureConsumer() throws IOException, JetStreamApiException {
    nats.jetStreamManagement().addOrUpdateConsumer(Subjects.TRAJECTORIES_STREAM, configuration());
    consumer = nats.jetStream().getConsumerContext(Subjects.TRAJECTORIES_STREAM, Subjects.DURABLE);
    health.consumer(true);
  }

  /** Starts pulling on its own thread. */
  public synchronized void start() {
    if (thread != null) {
      return;
    }
    running = true;
    thread = new Thread(this::run, "store-consumer");
    thread.start();
  }

  private void run() {
    while (running) {
      try {
        if (consumer == null) {
          ensureConsumer();
          log.info("consumer ready", Map.of("durable", Subjects.DURABLE));
          failures = 0;
        }
        Message msg = consumer.next(PULL_WAIT);
        if (msg != null) {
          process(msg);
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      } catch (IOException
          | JetStreamApiException
          | JetStreamStatusCheckedException
          | RuntimeException e) {
        health.consumer(false);
        consumer = null;
        if (!pause("consumer not ready", e.getMessage())) {
          return;
        }
      }
    }
  }

  /**
   * Handles one message and acks, naks or terminates it.
   *
   * @return the outcome, for the tests
   */
  StoreTrajectory.Outcome process(Message msg) throws InterruptedException {
    long start = System.nanoTime();
    StoreTrajectory.Outcome outcome = useCase.handle(msg.getData());
    switch (outcome) {
      case StoreTrajectory.Stored s -> {
        health.database(true);
        failures = 0;
        try {
          confirm(s);
          msg.ack();
          logTrajectory("info", s.duplicate() ? "duplicate" : "stored", s, start, null);
        } catch (IOException | JetStreamApiException | RuntimeException e) {
          // the rows are committed: the redelivery is a duplicate that confirms again
          msg.nakWithDelay(NAK_DELAY);
          logTrajectory("warn", "not confirmed", s, start, e.getMessage());
        }
      }
      case StoreTrajectory.Rejected r -> {
        msg.term();
        reportError(r);
        logTrajectory("error", "rejected", r, start, r.reason());
      }
      case StoreTrajectory.Retry r -> {
        health.database(false);
        msg.nakWithDelay(NAK_DELAY);
        logTrajectory("warn", "retry", r, start, r.reason());
        pause("database unavailable", r.reason());
      }
    }
    return outcome;
  }

  private void confirm(StoreTrajectory.Stored s) throws IOException, JetStreamApiException {
    TrajectoryStored stored =
        TrajectoryStored.newBuilder()
            .setLaunchId(s.launchId())
            .setStoredAt(timestamp(s.storedAt()))
            .setSampleCount(s.sampleCount())
            .build();
    nats.jetStream()
        .publish(
            Subjects.TRAJECTORIES_STORED,
            stored.toByteArray(),
            PublishOptions.builder().messageId(s.launchId()).build());
  }

  private void reportError(StoreTrajectory.Rejected r) {
    PipelineError error =
        PipelineError.newBuilder()
            .setLaunchId(r.launchId())
            .setService(Subjects.SERVICE)
            .setSubject(Subjects.TRAJECTORIES_COMPUTED)
            .setMessage(r.reason())
            .setOccurredAt(timestamp(Instant.now()))
            .build();
    try {
      // core NATS: the ERRORS stream keeps it; no Nats-Msg-Id (proto/README.md)
      nats.publish(Subjects.PIPELINE_ERRORS, error.toByteArray());
    } catch (RuntimeException e) {
      log.warn("cannot report the pipeline error", Map.of("error", String.valueOf(e.getMessage())));
    }
  }

  /** Logs and waits with {@link Backoff}; false when stopped meanwhile. */
  private boolean pause(String what, String error) {
    failures++;
    Duration delay = Backoff.delay(failures);
    log.error(
        what,
        Map.of(
            "error", String.valueOf(error),
            "health", "degraded",
            "attempt", String.valueOf(failures),
            "retry_in_ms", String.valueOf(delay.toMillis())));
    try {
      sleeper.sleep(delay);
      return running;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return false;
    }
  }

  private void logTrajectory(
      String level, String result, StoreTrajectory.Outcome o, long start, String error) {
    Map<String, String> fields = new LinkedHashMap<>();
    fields.put("launch_id", o.launchId());
    fields.put("outcome", result);
    if (o instanceof StoreTrajectory.Stored s) {
      fields.put("samples", String.valueOf(s.sampleCount()));
    }
    fields.put("duration_ms", String.valueOf((System.nanoTime() - start) / 1_000_000));
    if (error != null) {
      fields.put("error", error);
    }
    switch (level) {
      case "error" -> log.error("trajectory", fields);
      case "warn" -> log.warn("trajectory", fields);
      default -> log.info("trajectory", fields);
    }
  }

  private static Timestamp timestamp(Instant t) {
    return Timestamp.newBuilder().setSeconds(t.getEpochSecond()).setNanos(t.getNano()).build();
  }

  /** Stops pulling; a message being written finishes first (up to 10 s). */
  @Override
  public void close() {
    Thread t;
    synchronized (this) {
      running = false;
      t = thread;
      thread = null;
    }
    if (t != null) {
      try {
        t.join(10_000);
        if (t.isAlive()) {
          t.interrupt();
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
  }
}
