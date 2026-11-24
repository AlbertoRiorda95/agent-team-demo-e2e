package trajectory.store;

import com.google.protobuf.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import trajectory.v1.Trajectory.Sample;
import trajectory.v1.Trajectory.TrajectoryComputed;

/** The mapping of a validated {@code TrajectoryComputed} to the column values of V2. */
public final class TrajectoryRows {
  /** The status of every launch row M2 writes. */
  public static final String STATUS_STORED = "stored";

  private TrajectoryRows() {}

  /** {@code ground} or {@code time_limit}. */
  public static String endReason(TrajectoryComputed.EndReason reason) {
    return switch (reason) {
      case END_REASON_GROUND -> "ground";
      case END_REASON_TIME_LIMIT -> "time_limit";
      default -> throw new IllegalArgumentException("end_reason " + reason + " is not stored");
    };
  }

  /** {@code burn} or {@code ballistic}. */
  public static String phase(Sample.Phase phase) {
    return switch (phase) {
      case PHASE_BURN -> "burn";
      case PHASE_BALLISTIC -> "ballistic";
      default -> throw new IllegalArgumentException("phase " + phase + " is not stored");
    };
  }

  /** A protobuf timestamp as a {@code timestamptz} value (UTC). */
  public static OffsetDateTime timestamp(Timestamp ts) {
    return Instant.ofEpochSecond(ts.getSeconds(), ts.getNanos()).atOffset(ZoneOffset.UTC);
  }

  /**
   * One sample as a line of COPY text format: launch_id, seq, t_s, x_m, y_m, z_m, vx_mps,
   * vy_mps, vz_mps, phase, tab separated. No value needs escaping (a UUID, numbers, a phase).
   */
  public static void appendCopyLine(StringBuilder out, String launchId, Sample s) {
    out.append(launchId)
        .append('\t')
        .append(Integer.toUnsignedString(s.getSeq()))
        .append('\t')
        .append(s.getTS())
        .append('\t')
        .append(s.getXM())
        .append('\t')
        .append(s.getYM())
        .append('\t')
        .append(s.getZM())
        .append('\t')
        .append(s.getVxMps())
        .append('\t')
        .append(s.getVyMps())
        .append('\t')
        .append(s.getVzMps())
        .append('\t')
        .append(phase(s.getPhase()))
        .append('\n');
  }
}
