package trajectory.store;

import java.util.Arrays;

/**
 * The store config in force: read once per trajectory, so a config set while a trajectory is
 * being written does not affect it.
 *
 * @param version the {@code config_version} in force, 0 for the defaults
 * @param prefix the tables written to
 * @param sealedCredentials the sealed bytes the credentials came from, empty when they are the
 *     environment's (kept to save them again, never sent)
 * @param credentials the credentials of the database connections (only in memory)
 */
public record ConfigInForce(
    long version, TablePrefix prefix, byte[] sealedCredentials, DbCredentials credentials) {

  /** Copies the bytes: the record stays immutable. */
  public ConfigInForce {
    sealedCredentials = sealedCredentials.clone();
  }

  /** A copy of the sealed bytes. */
  @Override
  public byte[] sealedCredentials() {
    return sealedCredentials.clone();
  }

  /** The defaults: version 0, no prefix, the environment credentials. */
  public static ConfigInForce defaults(DbCredentials environment) {
    return new ConfigInForce(0, TablePrefix.NONE, new byte[0], environment);
  }

  @Override
  public boolean equals(Object o) {
    return o instanceof ConfigInForce c
        && version == c.version
        && prefix.equals(c.prefix)
        && Arrays.equals(sealedCredentials, c.sealedCredentials)
        && credentials.equals(c.credentials);
  }

  @Override
  public int hashCode() {
    return Long.hashCode(version) * 31 + prefix.hashCode();
  }

  /** No credentials, no sealed bytes. */
  @Override
  public String toString() {
    return "ConfigInForce[version=" + version + ", prefix=" + prefix.value() + "]";
  }
}
