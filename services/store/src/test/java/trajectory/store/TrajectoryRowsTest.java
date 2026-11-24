package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.google.protobuf.Timestamp;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import trajectory.v1.Trajectory.Sample;
import trajectory.v1.Trajectory.TrajectoryComputed;

/** Unit: the mapping of a trajectory to the column values. */
class TrajectoryRowsTest {
  @Test
  void mapsTheEnumsToTheirColumnValues() {
    assertEquals("ground", TrajectoryRows.endReason(TrajectoryComputed.EndReason.END_REASON_GROUND));
    assertEquals(
        "time_limit", TrajectoryRows.endReason(TrajectoryComputed.EndReason.END_REASON_TIME_LIMIT));
    assertEquals("burn", TrajectoryRows.phase(Sample.Phase.PHASE_BURN));
    assertEquals("ballistic", TrajectoryRows.phase(Sample.Phase.PHASE_BALLISTIC));
    assertThrows(
        IllegalArgumentException.class,
        () -> TrajectoryRows.phase(Sample.Phase.PHASE_UNSPECIFIED));
  }

  @Test
  void mapsTheTimestampToUtc() {
    assertEquals(
        OffsetDateTime.parse("2026-11-24T10:00:00.25Z"),
        TrajectoryRows.timestamp(
            Timestamp.newBuilder().setSeconds(1_795_514_400L).setNanos(250_000_000).build()));
  }

  @Test
  void writesOneCopyLineWithEveryColumn() {
    StringBuilder line = new StringBuilder();
    Sample s =
        Sample.newBuilder()
            .setSeq(7)
            .setTS(0.07)
            .setXM(1)
            .setYM(-2.5)
            .setZM(1e-10)
            .setVxMps(3)
            .setVyMps(4)
            .setVzMps(-5)
            .setPhase(Sample.Phase.PHASE_BALLISTIC)
            .build();
    TrajectoryRows.appendCopyLine(line, "0b6b7c2e-7d3a-4e8f-9a1b-2c3d4e5f6a7b", s);
    assertEquals(
        "0b6b7c2e-7d3a-4e8f-9a1b-2c3d4e5f6a7b\t7\t0.07\t1.0\t-2.5\t1.0E-10\t3.0\t4.0\t-5.0\tballistic\n",
        line.toString());
  }
}
