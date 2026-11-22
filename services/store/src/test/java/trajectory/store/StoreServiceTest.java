package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Start-up with NATS unreachable: degraded, logged, retried with backoff, never thrown. */
class StoreServiceTest {
  @Test
  void unreachableNatsIsDegradedAndRetried() {
    // nothing listens on port 1: the connection is refused at once
    StoreConfig config = new StoreConfig("jdbc:postgresql://127.0.0.1:1/x", "u", "p", "nats://127.0.0.1:1");
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    List<Duration> delays = new ArrayList<>();
    StoreService.Sleeper stopAfterTwo =
        delay -> {
          delays.add(delay);
          if (delays.size() == 2) {
            throw new InterruptedException("test stops the retries");
          }
        };
    try (StoreService service =
        new StoreService(config, new JsonLog(new PrintStream(out, true, StandardCharsets.UTF_8)), stopAfterTwo)) {
      assertThrows(InterruptedException.class, service::connectNats);
      assertEquals(Health.DEGRADED, service.health());
    }
    assertEquals(List.of(Duration.ofMillis(500), Duration.ofSeconds(1)), delays);
    String logs = out.toString(StandardCharsets.UTF_8);
    assertTrue(logs.contains("\"msg\":\"cannot connect to NATS\""), logs);
    assertTrue(logs.contains("\"health\":\"degraded\""), logs);
  }

  @Test
  void unreachableDatabaseIsDegradedAndRetried() {
    StoreConfig config = new StoreConfig("jdbc:postgresql://127.0.0.1:1/x", "u", "p", "nats://127.0.0.1:1");
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    StoreService.Sleeper stopAtOnce =
        delay -> {
          throw new InterruptedException("test stops the retries");
        };
    try (StoreService service =
        new StoreService(config, new JsonLog(new PrintStream(out, true, StandardCharsets.UTF_8)), stopAtOnce)) {
      assertThrows(InterruptedException.class, service::start);
      assertEquals(Health.DEGRADED, service.health());
    }
    String logs = out.toString(StandardCharsets.UTF_8);
    assertTrue(logs.contains("\"msg\":\"cannot apply the database migrations\""), logs);
    assertTrue(!logs.contains("\"p\""), "the password is not logged");
  }

  @Test
  void errorsAreOneLineWithoutNatsCredentials() {
    StoreConfig config =
        new StoreConfig("jdbc:postgresql://db/x", "u", "p", "nats://user:token@nats:4222");
    StoreService service =
        new StoreService(config, new JsonLog(System.err), delay -> {});
    assertEquals(
        "Unable to connect to nats://***@nats:4222",
        service.describe(
            new java.io.IOException("Unable to connect to nats://user:token@nats:4222\nmore")));
  }
}
