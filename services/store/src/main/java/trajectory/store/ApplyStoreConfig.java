package trajectory.store;

import com.google.protobuf.InvalidProtocolBufferException;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import trajectory.v1.Config.ConfigSet;
import trajectory.v1.Config.StoreConfig;

/**
 * The use case of a {@code config.store.set} message: decode, validate, apply the version rule
 * (higher applied, equal re-acknowledged, lower {@code stale version}), open and test the sealed
 * credentials, migrate a new prefix, save the local file, then put the config in force. On any
 * failure the config in force is unchanged. Holds the config in force (thread safe).
 */
public final class ApplyStoreConfig {
  /** What the use case needs from the outside. */
  public interface Ports {
    /** Applies the migrations of {@code prefix} with {@code credentials}. */
    void migrate(TablePrefix prefix, DbCredentials credentials) throws Exception;

    /** Opens and closes a connection with {@code credentials}. */
    void testConnection(DbCredentials credentials) throws Exception;

    /** Saves the config to the local file. */
    void save(LocalConfigFile.Content content) throws Exception;
  }

  /**
   * The answer to one set.
   *
   * @param ok applied (or the same version acknowledged again)
   * @param error why not, empty when ok
   * @param changed a new config is in force
   * @param inForce the config in force after the set
   */
  public record Result(boolean ok, String error, boolean changed, ConfigInForce inForce) {}

  /** The error of a version lower than the one in force. */
  public static final String STALE_VERSION = "stale version";
  /** The error of sealed credentials without a valid {@code STORE_CONFIG_KEY}. */
  public static final String NO_CONFIG_KEY = "no config key";

  private final Optional<CredentialSealing> sealing;
  private final Ports ports;
  private final AtomicReference<ConfigInForce> inForce;

  /**
   * Creates the use case.
   *
   * @param initial the config in force at start-up
   * @param sealing the key of {@code STORE_CONFIG_KEY}, empty when missing or invalid
   * @param ports the database and the file
   */
  public ApplyStoreConfig(
      ConfigInForce initial, Optional<CredentialSealing> sealing, Ports ports) {
    this.inForce = new AtomicReference<>(initial);
    this.sealing = sealing;
    this.ports = ports;
  }

  /** The config in force now. */
  public ConfigInForce inForce() {
    return inForce.get();
  }

  /**
   * Handles one set. Sets are handled one at a time (the caller's single dispatcher thread; the
   * method is synchronized anyway).
   *
   * @param data the payload of the NATS message
   * @return the answer, never thrown
   */
  public synchronized Result handle(byte[] data) {
    ConfigInForce current = inForce.get();
    ConfigSet set;
    try {
      set = ConfigSet.parseFrom(data);
    } catch (InvalidProtocolBufferException e) {
      return refused(current, "not a trajectory.v1.ConfigSet");
    }
    if (!Subjects.SERVICE.equals(set.getService())) {
      return refused(current, "service must be store");
    }
    if (set.getPayloadCase() != ConfigSet.PayloadCase.STORE) {
      return refused(current, "no store payload");
    }
    long version = set.getConfigVersion();
    if (version < 0) {
      return refused(current, "config_version out of range");
    }
    StoreConfig payload = set.getStore();
    TablePrefix prefix;
    try {
      prefix = new TablePrefix(payload.getTablePrefix());
    } catch (IllegalArgumentException e) {
      return refused(current, "table prefix must be empty or match ^[a-z][a-z0-9_]{0,15}$");
    }
    byte[] sealed = payload.getDbCredentialsSealed().toByteArray();
    if (sealed.length > 0 && sealed.length < CredentialSealing.MIN_SEALED_BYTES) {
      return refused(current, "sealed credentials too short");
    }
    if (version < current.version()) {
      return refused(current, STALE_VERSION);
    }
    if (version == current.version()) {
      return new Result(true, "", false, current);
    }

    DbCredentials credentials = current.credentials();
    byte[] sealedInForce = current.sealedCredentials();
    if (sealed.length > 0) {
      if (sealing.isEmpty()) {
        return refused(current, NO_CONFIG_KEY);
      }
      try {
        credentials = sealing.get().open(sealed);
      } catch (CredentialSealing.SealingException e) {
        return refused(current, e.getMessage());
      }
      try {
        ports.testConnection(credentials);
      } catch (Exception e) {
        return refused(current, "cannot connect with the new credentials: " + oneLine(e));
      }
      sealedInForce = sealed;
    }
    if (!prefix.equals(current.prefix())) {
      try {
        ports.migrate(prefix, credentials);
      } catch (Exception e) {
        return refused(current, "cannot migrate the tables of the prefix: " + oneLine(e));
      }
    }
    try {
      ports.save(new LocalConfigFile.Content(version, prefix, sealedInForce));
    } catch (Exception e) {
      return refused(current, "cannot save the local config file: " + oneLine(e));
    }
    ConfigInForce next = new ConfigInForce(version, prefix, sealedInForce, credentials);
    inForce.set(next);
    return new Result(true, "", true, next);
  }

  private static Result refused(ConfigInForce current, String error) {
    return new Result(false, error, false, current);
  }

  /**
   * The first line of the error. The database and file errors carry no credentials: pgjdbc names
   * the user, never the password.
   */
  private static String oneLine(Exception e) {
    String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    int end = msg.indexOf('\n');
    return end < 0 ? msg : msg.substring(0, end);
  }
}
