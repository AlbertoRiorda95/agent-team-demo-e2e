package trajectory.store;

import java.time.Instant;
import trajectory.v1.Trajectory.TrajectoryComputed;

/** The port to the database: writes one trajectory in one transaction. */
public interface TrajectoryRepository {
  /**
   * What the database holds for the launch after {@link #save}.
   *
   * @param duplicate the launch was already there: nothing was written
   * @param sampleCount the stored {@code sample_count}
   * @param storedAt the stored {@code stored_at}
   */
  record Saved(boolean duplicate, int sampleCount, Instant storedAt) {}

  /** The database cannot be reached now (SQL state class 08, no connection...): retry later. */
  final class UnavailableException extends Exception {
    private static final long serialVersionUID = 1L;

    /** Wraps the cause; its message is a single line for the logs. */
    public UnavailableException(String message, Throwable cause) {
      super(message, cause);
    }
  }

  /** The database refuses these values (SQL state classes 22 and 23): never retried. */
  final class RejectedException extends Exception {
    private static final long serialVersionUID = 1L;

    /** Wraps the cause; its message is a single line for the logs. */
    public RejectedException(String message, Throwable cause) {
      super(message, cause);
    }
  }

  /**
   * Inserts the launch and its samples in the tables of {@code prefix}, as {@code credentials},
   * or nothing when the launch is already there.
   *
   * @param trajectory a validated trajectory ({@link TrajectoryValidation})
   * @param prefix the tables to write to
   * @param credentials the database user that writes
   * @return what is stored for the launch
   * @throws UnavailableException rolled back, to retry
   * @throws RejectedException rolled back, not to retry
   */
  Saved save(TrajectoryComputed trajectory, TablePrefix prefix, DbCredentials credentials)
      throws UnavailableException, RejectedException;
}
