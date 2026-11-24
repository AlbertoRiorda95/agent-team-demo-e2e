package trajectory.store;

import io.nats.client.support.JsonParseException;
import io.nats.client.support.JsonParser;
import io.nats.client.support.JsonValue;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * The store's local config file at {@code STORE_CONFIG_PATH}: JSON {@code {"config_version",
 * "table_prefix", "db_credentials_sealed" (base64, absent for the environment credentials)}}. The
 * credentials stay sealed in it. Written to a temporary file in the same folder, then renamed.
 */
public final class LocalConfigFile {
  /** The default path ({@code STORE_CONFIG_PATH} unset). */
  public static final Path DEFAULT_PATH = Path.of("/var/lib/store/config.json");

  /**
   * What the file holds.
   *
   * @param version the config version
   * @param prefix the table prefix
   * @param sealedCredentials the sealed credentials, empty when none
   */
  public record Content(long version, TablePrefix prefix, byte[] sealedCredentials) {
    /** Copies the bytes. */
    public Content {
      sealedCredentials = sealedCredentials.clone();
    }

    /** A copy of the sealed bytes. */
    @Override
    public byte[] sealedCredentials() {
      return sealedCredentials.clone();
    }

    @Override
    public boolean equals(Object o) {
      return o instanceof Content c
          && version == c.version
          && prefix.equals(c.prefix)
          && Arrays.equals(sealedCredentials, c.sealedCredentials);
    }

    @Override
    public int hashCode() {
      return Long.hashCode(version) * 31 + prefix.hashCode();
    }

    /** Without the sealed bytes. */
    @Override
    public String toString() {
      return "Content[version=" + version + ", prefix=" + prefix.value() + "]";
    }
  }

  /** The file is there but cannot be used; the message never holds its content. */
  public static final class InvalidFileException extends Exception {
    private static final long serialVersionUID = 1L;

    InvalidFileException(String message) {
      super(message);
    }
  }

  private final Path path;

  /**
   * The file at {@code path}.
   *
   * @param path {@code STORE_CONFIG_PATH}
   */
  public LocalConfigFile(Path path) {
    this.path = path;
  }

  /** Where the file is. */
  public Path path() {
    return path;
  }

  /**
   * Reads the file.
   *
   * @return its content, empty when there is no file
   * @throws IOException when it cannot be read
   * @throws InvalidFileException when it is not a valid config
   */
  public Optional<Content> load() throws IOException, InvalidFileException {
    byte[] raw;
    try {
      raw = Files.readAllBytes(path);
    } catch (NoSuchFileException e) {
      return Optional.empty();
    }
    JsonValue json;
    try {
      json = JsonParser.parse(raw);
    } catch (JsonParseException e) {
      throw new InvalidFileException("not JSON");
    }
    if (json.type != JsonValue.Type.MAP) {
      throw new InvalidFileException("not a JSON object");
    }
    JsonValue version = json.map.get("config_version");
    if (version == null
        || !(version.type == JsonValue.Type.INTEGER || version.type == JsonValue.Type.LONG)
        || version.number.longValue() < 0) {
      throw new InvalidFileException("config_version missing or invalid");
    }
    JsonValue prefix = json.map.get("table_prefix");
    if (prefix == null || prefix.type != JsonValue.Type.STRING) {
      throw new InvalidFileException("table_prefix missing");
    }
    TablePrefix tablePrefix;
    try {
      tablePrefix = new TablePrefix(prefix.string);
    } catch (IllegalArgumentException e) {
      throw new InvalidFileException("table_prefix invalid");
    }
    byte[] sealed = new byte[0];
    JsonValue s = json.map.get("db_credentials_sealed");
    if (s != null && s.type != JsonValue.Type.NULL) {
      if (s.type != JsonValue.Type.STRING) {
        throw new InvalidFileException("db_credentials_sealed is not a string");
      }
      try {
        sealed = Base64.getDecoder().decode(s.string);
      } catch (IllegalArgumentException e) {
        throw new InvalidFileException("db_credentials_sealed is not base64");
      }
    }
    return Optional.of(new Content(version.number.longValue(), tablePrefix, sealed));
  }

  /**
   * Writes the file: a temporary file next to it (owner read/write only where POSIX), then a
   * rename over the old one.
   *
   * @param content what to write
   * @throws IOException when the folder is not writable
   */
  public void save(Content content) throws IOException {
    Map<String, JsonValue> map = new LinkedHashMap<>();
    map.put("config_version", new JsonValue(content.version()));
    map.put("table_prefix", new JsonValue(content.prefix().value()));
    byte[] sealed = content.sealedCredentials();
    if (sealed.length > 0) {
      map.put("db_credentials_sealed", new JsonValue(Base64.getEncoder().encodeToString(sealed)));
    }
    byte[] bytes = new JsonValue(map).toJson().getBytes(StandardCharsets.UTF_8);
    Path dir = path.toAbsolutePath().getParent();
    Files.createDirectories(dir);
    Path tmp = Files.createTempFile(dir, ".config-", ".tmp");
    try {
      try {
        Files.setPosixFilePermissions(tmp, PosixFilePermissions.fromString("rw-------"));
      } catch (UnsupportedOperationException e) {
        // not a POSIX file system: the folder's permissions apply
      }
      Files.write(tmp, bytes);
      try {
        Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      } catch (AtomicMoveNotSupportedException e) {
        Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
      }
    } finally {
      Files.deleteIfExists(tmp);
    }
  }
}
