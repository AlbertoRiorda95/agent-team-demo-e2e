package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import trajectory.v1.Trajectory.TrajectoryComputed;

/** Unit: the use case with a fake repository (outcomes, the prefix read once per message). */
class StoreTrajectoryTest {
  private static final Instant NOW = Instant.parse("2026-11-24T10:00:00Z");

  private final List<TablePrefix> prefixes = new ArrayList<>();

  private TrajectoryRepository answering(Object answer) {
    return (TrajectoryComputed t, TablePrefix prefix) -> {
      prefixes.add(prefix);
      if (answer instanceof TrajectoryRepository.UnavailableException e) {
        throw e;
      }
      if (answer instanceof TrajectoryRepository.RejectedException e) {
        throw e;
      }
      return (TrajectoryRepository.Saved) answer;
    };
  }

  @Test
  void storedAndDuplicateCarryTheStoredCount() {
    var t = Trajectories.valid(4);
    var stored =
        new StoreTrajectory(
                answering(new TrajectoryRepository.Saved(false, 4, NOW)), () -> TablePrefix.NONE)
            .handle(t.toByteArray());
    assertEquals(new StoreTrajectory.Stored(t.getLaunchId(), 4, NOW, false), stored);
    var dup =
        new StoreTrajectory(
                answering(new TrajectoryRepository.Saved(true, 4, NOW)), () -> TablePrefix.NONE)
            .handle(t.toByteArray());
    assertEquals(new StoreTrajectory.Stored(t.getLaunchId(), 4, NOW, true), dup);
  }

  @Test
  void undecodableAndInvalidAreRejectedWithoutWriting() {
    var useCase =
        new StoreTrajectory(
            answering(new TrajectoryRepository.Saved(false, 1, NOW)), () -> TablePrefix.NONE);
    var notProto = useCase.handle(new byte[] {(byte) 0xff, 0x01});
    assertEquals(new StoreTrajectory.Rejected("", "not a trajectory.v1.TrajectoryComputed"), notProto);
    var empty = useCase.handle(Trajectories.valid(3).toBuilder().clearSamples().build().toByteArray());
    assertInstanceOf(StoreTrajectory.Rejected.class, empty);
    assertTrue(prefixes.isEmpty(), "the repository is not called");
  }

  @Test
  void databaseFailuresAreRetryOrRejected() {
    var t = Trajectories.valid(2);
    var down = new TrajectoryRepository.UnavailableException("database unavailable: x", null);
    assertEquals(
        new StoreTrajectory.Retry(t.getLaunchId(), "database unavailable: x"),
        new StoreTrajectory(answering(down), () -> TablePrefix.NONE).handle(t.toByteArray()));
    var refused = new TrajectoryRepository.RejectedException("database refused: y", null);
    assertEquals(
        new StoreTrajectory.Rejected(t.getLaunchId(), "database refused: y"),
        new StoreTrajectory(answering(refused), () -> TablePrefix.NONE).handle(t.toByteArray()));
  }

  @Test
  void usesThePrefixInForceAtTheStartOfEachMessage() {
    TablePrefix[] inForce = {TablePrefix.NONE};
    var useCase =
        new StoreTrajectory(
            answering(new TrajectoryRepository.Saved(false, 1, NOW)), () -> inForce[0]);
    useCase.handle(Trajectories.valid(1).toByteArray());
    inForce[0] = new TablePrefix("demo_");
    useCase.handle(Trajectories.valid(1).toByteArray());
    assertEquals(List.of(TablePrefix.NONE, new TablePrefix("demo_")), prefixes);
  }

  @Test
  void sqlStateClasses22And23AreRejectedTheOthersRetried() {
    assertTrue(PostgresTrajectoryRepository.isRejected(new SQLException("x", "22P02")));
    assertTrue(PostgresTrajectoryRepository.isRejected(new SQLException("x", "23505")));
    assertTrue(!PostgresTrajectoryRepository.isRejected(new SQLException("x", "08006")));
    assertTrue(!PostgresTrajectoryRepository.isRejected(new SQLException("x", "57P01")));
    assertTrue(!PostgresTrajectoryRepository.isRejected(new SQLException("x")));
  }
}
