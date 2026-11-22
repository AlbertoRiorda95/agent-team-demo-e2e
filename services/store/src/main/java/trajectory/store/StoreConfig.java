package trajectory.store;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Map;

/**
 * The store's configuration, read from the environment and validated before anything starts.
 *
 * @param jdbcUrl the JDBC URL built from {@code DATABASE_URL}
 * @param databaseUser {@code DATABASE_USER}
 * @param databasePassword {@code DATABASE_PASSWORD} (never logged)
 * @param natsUrl {@code NATS_URL}, {@code nats://localhost:4222} when unset
 */
public record StoreConfig(
    String jdbcUrl, String databaseUser, String databasePassword, String natsUrl) {

  /** The NATS URL when {@code NATS_URL} is not set (the local compose stack). */
  public static final String DEFAULT_NATS_URL = "nats://localhost:4222";

  /** Hides the password from {@link #toString()}. */
  @Override
  public String toString() {
    return "StoreConfig[jdbcUrl=" + jdbcUrl + ", databaseUser=" + databaseUser
        + ", natsUrl=" + redact(natsUrl) + "]";
  }

  /**
   * Reads and validates the configuration.
   *
   * @param env the environment ({@code System.getenv()} in the service)
   * @return the configuration
   * @throws IllegalArgumentException naming the variable that is missing or invalid (never its
   *     value)
   */
  public static StoreConfig fromEnvironment(Map<String, String> env) {
    String jdbcUrl = toJdbcUrl(required(env, "DATABASE_URL"));
    String user = required(env, "DATABASE_USER");
    String password = required(env, "DATABASE_PASSWORD");
    String nats = env.getOrDefault("NATS_URL", "").strip();
    if (nats.isEmpty()) {
      nats = DEFAULT_NATS_URL;
    }
    URI natsUri = parse(nats, "NATS_URL");
    if (!"nats".equals(natsUri.getScheme()) || natsUri.getHost() == null) {
      throw new IllegalArgumentException("NATS_URL must be nats://<host>[:<port>]");
    }
    return new StoreConfig(jdbcUrl, user, password, nats);
  }

  /**
   * Converts {@code postgresql://host[:port]/database[?params]} (the form of {@code .env.example})
   * to {@code jdbc:postgresql://...}. Credentials in the URL are refused: they belong in {@code
   * DATABASE_USER} and {@code DATABASE_PASSWORD}.
   */
  static String toJdbcUrl(String databaseUrl) {
    String url = databaseUrl.startsWith("jdbc:") ? databaseUrl.substring(5) : databaseUrl;
    URI uri = parse(url, "DATABASE_URL");
    String scheme = uri.getScheme();
    if (!"postgresql".equals(scheme) && !"postgres".equals(scheme)) {
      throw new IllegalArgumentException(
          "DATABASE_URL must be postgresql://<host>[:<port>]/<database>");
    }
    if (uri.getRawUserInfo() != null) {
      throw new IllegalArgumentException(
          "DATABASE_URL must not contain credentials: use DATABASE_USER and DATABASE_PASSWORD");
    }
    String path = uri.getRawPath();
    if (uri.getHost() == null || path == null || path.length() < 2) {
      throw new IllegalArgumentException(
          "DATABASE_URL must be postgresql://<host>[:<port>]/<database>");
    }
    String port = uri.getPort() == -1 ? "" : ":" + uri.getPort();
    String query = uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery();
    return "jdbc:postgresql://" + uri.getHost() + port + path + query;
  }

  /** The URL without its user information, for the logs. */
  static String redact(String url) {
    try {
      URI uri = new URI(url);
      if (uri.getRawUserInfo() == null) {
        return url;
      }
      return new URI(
              uri.getScheme(), "***", uri.getHost(), uri.getPort(), uri.getPath(), null, null)
          .toString();
    } catch (URISyntaxException e) {
      return "<invalid url>";
    }
  }

  private static String required(Map<String, String> env, String name) {
    String value = env.get(name);
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(name + " is not set");
    }
    return value.strip();
  }

  private static URI parse(String value, String name) {
    try {
      return new URI(value);
    } catch (URISyntaxException e) {
      throw new IllegalArgumentException(name + " is not a valid URL", e);
    }
  }
}
