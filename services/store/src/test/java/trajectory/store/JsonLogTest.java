package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

class JsonLogTest {
  @Test
  void writesOneEscapedJsonObject() {
    String line =
        JsonLog.format(
            Instant.parse("2026-11-22T00:00:00Z"), "error", "a \"quoted\"\nmsg", Map.of("k", "\\\u0001"));
    assertEquals(
        "{\"ts\":\"2026-11-22T00:00:00Z\",\"level\":\"error\",\"service\":\"store\","
            + "\"msg\":\"a \\\"quoted\\\"\\nmsg\",\"k\":\"\\\\\\u0001\"}",
        line);
  }
}
