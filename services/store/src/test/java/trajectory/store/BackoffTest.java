package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class BackoffTest {
  @Test
  void doublesFromHalfASecondUpToThirtySeconds() {
    assertEquals(Duration.ofMillis(500), Backoff.delay(1));
    assertEquals(Duration.ofSeconds(1), Backoff.delay(2));
    assertEquals(Duration.ofSeconds(16), Backoff.delay(6));
    assertEquals(Duration.ofSeconds(30), Backoff.delay(7));
    assertEquals(Duration.ofSeconds(30), Backoff.delay(Integer.MAX_VALUE));
    assertThrows(IllegalArgumentException.class, () -> Backoff.delay(0));
  }
}
