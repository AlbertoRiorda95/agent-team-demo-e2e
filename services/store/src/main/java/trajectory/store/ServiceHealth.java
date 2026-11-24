package trajectory.store;

import java.util.ArrayList;
import java.util.List;

/**
 * What the store knows about its own health, set by the adapters, read by the heartbeat. Thread
 * safe.
 */
public final class ServiceHealth {
  /** The reason when the database is down. */
  public static final String DATABASE_DOWN = "database unavailable";
  /** The reason when NATS is down. */
  public static final String NATS_DOWN = "not connected to NATS";
  /** The reason when the durable consumer is not there. */
  public static final String CONSUMER_DOWN = "consumer not ready";
  /** The reason when {@code STORE_CONFIG_KEY} is missing or not 32 bytes. */
  public static final String CONFIG_KEY_MISSING = "STORE_CONFIG_KEY missing or invalid";
  /** The reason when the local config file could not be used at start-up. */
  public static final String CONFIG_FILE_INVALID = "local config file invalid";

  /**
   * The state and its reason, as in a {@code ServiceStatus}.
   *
   * @param health ok or degraded
   * @param detail the reasons, separated by "; ", empty when ok
   */
  public record Report(Health health, String detail) {}

  private volatile boolean database;
  private volatile boolean nats;
  private volatile boolean consumer;
  private volatile boolean configKey = true;
  private volatile boolean configFile = true;

  /** The database answered (or not). */
  public void database(boolean up) {
    database = up;
  }

  /** NATS connected (or not). */
  public void nats(boolean up) {
    nats = up;
  }

  /** The durable consumer exists and answers (or not). */
  public void consumer(boolean up) {
    consumer = up;
  }

  /** {@code STORE_CONFIG_KEY} valid (or not); valid by default. */
  public void configKey(boolean valid) {
    configKey = valid;
  }

  /** The local config file usable (or not, until a set is applied); usable by default. */
  public void configFile(boolean valid) {
    configFile = valid;
  }

  /** {@code ok} when everything is up, else {@code degraded} with every reason. */
  public Report report() {
    List<String> reasons = new ArrayList<>();
    if (!database) {
      reasons.add(DATABASE_DOWN);
    }
    if (!nats) {
      reasons.add(NATS_DOWN);
    }
    if (!consumer) {
      reasons.add(CONSUMER_DOWN);
    }
    if (!configKey) {
      reasons.add(CONFIG_KEY_MISSING);
    }
    if (!configFile) {
      reasons.add(CONFIG_FILE_INVALID);
    }
    return reasons.isEmpty()
        ? new Report(Health.OK, "")
        : new Report(Health.DEGRADED, String.join("; ", reasons));
  }
}
