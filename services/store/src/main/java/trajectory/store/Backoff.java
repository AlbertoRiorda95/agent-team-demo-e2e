package trajectory.store;

import java.time.Duration;

/** Retry delays: 0.5 s, doubling after each failure, at most 30 s (as the propagator). */
public final class Backoff {
  static final Duration FIRST = Duration.ofMillis(500);
  static final Duration MAX = Duration.ofSeconds(30);

  private Backoff() {}

  /**
   * The delay before retry number {@code attempt}.
   *
   * @param attempt 1 for the first retry
   * @return the delay, between {@link #FIRST} and {@link #MAX}
   */
  public static Duration delay(int attempt) {
    if (attempt < 1) {
      throw new IllegalArgumentException("attempt must be >= 1");
    }
    // 500 ms << 6 = 32 s is already above MAX: no overflow for large attempts
    int shift = Math.min(attempt - 1, 6);
    Duration d = FIRST.multipliedBy(1L << shift);
    return d.compareTo(MAX) > 0 ? MAX : d;
  }
}
