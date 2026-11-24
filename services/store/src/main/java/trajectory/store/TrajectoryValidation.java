package trajectory.store;

import java.util.Optional;
import java.util.regex.Pattern;
import trajectory.v1.Trajectory.Sample;
import trajectory.v1.Trajectory.TrajectoryComputed;

/**
 * The edge check of a decoded {@code TrajectoryComputed}: a message that fails it is terminated,
 * logged and reported as a {@code PipelineError}, never written (proto/README.md > Encoding).
 */
public final class TrajectoryValidation {
  private static final Pattern UUID_PATTERN =
      Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

  private TrajectoryValidation() {}

  /**
   * Why the trajectory cannot be stored.
   *
   * @param t the decoded message
   * @return the reason, or empty when it is valid
   */
  public static Optional<String> problem(TrajectoryComputed t) {
    if (t.getLaunchId().isEmpty()) {
      return Optional.of("launch_id is empty");
    }
    if (!isUuid(t.getLaunchId())) {
      return Optional.of("launch_id is not a UUID");
    }
    if (!t.hasAcceptedAt() || !t.hasComputedAt()) {
      return Optional.of("accepted_at or computed_at is missing");
    }
    if (!t.hasRequest() || !t.getRequest().hasPosition() || !t.hasConfig()) {
      return Optional.of("request, request.position or config is missing");
    }
    if (t.getEndReason() == TrajectoryComputed.EndReason.END_REASON_UNSPECIFIED
        || t.getEndReason() == TrajectoryComputed.EndReason.UNRECOGNIZED) {
      return Optional.of("end_reason is unspecified or unknown");
    }
    if (t.getSamplesCount() == 0) {
      return Optional.of("no samples");
    }
    for (int i = 0; i < t.getSamplesCount(); i++) {
      Sample s = t.getSamples(i);
      if (s.getSeq() != i) {
        return Optional.of("samples[" + i + "].seq is " + Integer.toUnsignedString(s.getSeq()));
      }
      if (s.getPhase() == Sample.Phase.PHASE_UNSPECIFIED
          || s.getPhase() == Sample.Phase.UNRECOGNIZED) {
        return Optional.of("samples[" + i + "].phase is unspecified or unknown");
      }
    }
    return Optional.empty();
  }

  /**
   * The canonical form only: UUID.fromString also accepts short groups ("1-1-1-1-1") and signs,
   * and the value goes as is into the COPY text of the samples.
   */
  private static boolean isUuid(String s) {
    return UUID_PATTERN.matcher(s).matches();
  }
}
