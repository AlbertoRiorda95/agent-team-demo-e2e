package trajectory.store;

import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.api.StreamConfiguration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.stream.Stream;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.MountableFile;

/**
 * The real infrastructure of the tests (Testcontainers; needs Docker): PostgreSQL 17, and NATS
 * with the repository's own server config ({@code deploy/nats/nats.conf}: 8 MiB max payload) and
 * streams ({@code proto/nats/streams/*.json}).
 */
final class TestInfra {
  /** The repository root, from the Gradle working directory {@code services/store}. */
  static final Path ROOT = Path.of("../..").toAbsolutePath().normalize();

  private TestInfra() {}

  static PostgreSQLContainer postgres() {
    return new PostgreSQLContainer("postgres:17-alpine");
  }

  @SuppressWarnings("resource")
  static GenericContainer<?> nats() {
    return new GenericContainer<>("nats:2-alpine")
        .withCopyFileToContainer(
            MountableFile.forHostPath(ROOT.resolve("deploy/nats/nats.conf")), "/etc/nats/nats.conf")
        .withCommand("--config", "/etc/nats/nats.conf")
        .withExposedPorts(4222)
        .waitingFor(Wait.forLogMessage(".*Server is ready.*", 1));
  }

  static String natsUrl(GenericContainer<?> nats) {
    return "nats://" + nats.getHost() + ":" + nats.getFirstMappedPort();
  }

  /** Creates the streams as {@code nats-init} does in compose. */
  @SuppressWarnings("try") // Connection.close() may throw InterruptedException: fine in a test
  static void createStreams(GenericContainer<?> nats) throws Exception {
    try (Connection conn = Nats.connect(natsUrl(nats));
        Stream<Path> files = Files.list(ROOT.resolve("proto/nats/streams"))) {
      var jsm = conn.jetStreamManagement();
      for (Path f : files.filter(p -> p.toString().endsWith(".json")).sorted().toList()) {
        jsm.addStream(StreamConfiguration.instance(Files.readString(f)));
      }
    }
  }

  static StoreConfig config(PostgreSQLContainer pg, GenericContainer<?> nats) {
    return config(pg, pg.getFirstMappedPort(), natsUrl(nats));
  }

  static StoreConfig config(PostgreSQLContainer pg, int pgPort, String natsUrl) {
    return StoreConfig.fromEnvironment(
        Map.of(
            "DATABASE_URL",
            "postgresql://" + pg.getHost() + ":" + pgPort + "/" + pg.getDatabaseName(),
            "DATABASE_USER", pg.getUsername(),
            "DATABASE_PASSWORD", pg.getPassword(),
            "NATS_URL", natsUrl));
  }
}
