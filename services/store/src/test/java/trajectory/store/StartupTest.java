package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** The whole start-up against real PostgreSQL 17 and NATS (Testcontainers; needs Docker). */
class StartupTest {
  @Test
  void migratesConnectsAndCreatesTheConsumerThenIsOk() throws Exception {
    try (var postgres = TestInfra.postgres();
        var nats = TestInfra.nats()) {
      postgres.start();
      nats.start();
      TestInfra.createStreams(nats);
      StoreConfig config = TestInfra.config(postgres, nats);
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
      assertTrue(logs.contains("\"msg\":\"consumer ready\""), logs);
    }
  }
}
