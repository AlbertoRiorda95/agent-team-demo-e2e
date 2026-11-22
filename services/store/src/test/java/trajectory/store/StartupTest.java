package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** The whole start-up against real PostgreSQL 17 and NATS (Testcontainers; needs Docker). */
class StartupTest {
  @Test
  void migratesAndConnectsThenIsOk() throws InterruptedException {
    try (var postgres = new PostgreSQLContainer("postgres:17-alpine");
        var nats =
            new GenericContainer<>("nats:2-alpine")
                .withCommand("--jetstream")
                .withExposedPorts(4222)
                .waitingFor(Wait.forLogMessage(".*Server is ready.*", 1))) {
      postgres.start();
      nats.start();
      StoreConfig config =
          StoreConfig.fromEnvironment(
              Map.of(
                  "DATABASE_URL",
                  "postgresql://" + postgres.getHost() + ":" + postgres.getFirstMappedPort() + "/"
                      + postgres.getDatabaseName(),
                  "DATABASE_USER", postgres.getUsername(),
                  "DATABASE_PASSWORD", postgres.getPassword(),
                  "NATS_URL", "nats://" + nats.getHost() + ":" + nats.getFirstMappedPort()));
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      try (StoreService service =
          new StoreService(
              config,
              new JsonLog(new PrintStream(out, true, StandardCharsets.UTF_8)),
              delay -> {
                throw new AssertionError("no retry expected");
              })) {
        service.start();
        assertEquals(Health.OK, service.health());
      }
      String logs = out.toString(StandardCharsets.UTF_8);
      assertTrue(logs.contains("\"msg\":\"database migrated\""), logs);
      assertTrue(logs.contains("\"msg\":\"connected to NATS\""), logs);
    }
  }
}
