package trajectory.store;

import com.google.protobuf.InvalidProtocolBufferException;
import java.time.Instant;
import java.util.Optional;
import java.util.function.Supplier;
import trajectory.v1.Trajectory.TrajectoryComputed;

/**
 * The use case of a {@code trajectories.computed} message: decode, validate, write in the tables
 * of the prefix in force. The caller turns the {@link Outcome} into NATS actions.
 */
public final class StoreTrajectory {
  /** What happened to one message. */
  public sealed interface Outcome {
    /** The launch_id, empty when the message did not decode. */
    String launchId();
  }

  /**
   * Written now, or already there ({@code duplicate}): confirm with a {@code TrajectoryStored}.
   */
  public record Stored(String launchId, int sampleCount, Instant storedAt, boolean duplicate)
      implements Outcome {}

  /** Invalid, or refused by the database: terminate and report a {@code PipelineError}. */
  public record Rejected(String launchId, String reason) implements Outcome {}

  /** The database is unavailable: nothing written, redeliver later. */
  public record Retry(String launchId, String reason) implements Outcome {}

  private final TrajectoryRepository repository;
  private final Supplier<TablePrefix> prefixInForce;

  /**
   * Creates the use case.
   *
   * @param repository where the trajectories go
   * @param prefixInForce the table prefix in force, read once per message (a config change while
   *     a trajectory is being written does not affect it)
   */
  public StoreTrajectory(TrajectoryRepository repository, Supplier<TablePrefix> prefixInForce) {
    this.repository = repository;
    this.prefixInForce = prefixInForce;
  }

  /**
   * Handles one message.
   *
   * @param data the payload of the NATS message
   * @return the outcome, never thrown
   */
  public Outcome handle(byte[] data) {
    TrajectoryComputed t;
    try {
      t = TrajectoryComputed.parseFrom(data);
    } catch (InvalidProtocolBufferException e) {
      return new Rejected("", "not a trajectory.v1.TrajectoryComputed");
    }
    Optional<String> problem = TrajectoryValidation.problem(t);
    if (problem.isPresent()) {
      return new Rejected(t.getLaunchId(), problem.get());
    }
    TablePrefix prefix = prefixInForce.get();
    try {
      TrajectoryRepository.Saved saved = repository.save(t, prefix);
      return new Stored(t.getLaunchId(), saved.sampleCount(), saved.storedAt(), saved.duplicate());
    } catch (TrajectoryRepository.UnavailableException e) {
      return new Retry(t.getLaunchId(), e.getMessage());
    } catch (TrajectoryRepository.RejectedException e) {
      return new Rejected(t.getLaunchId(), e.getMessage());
    }
  }
}
