package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import trajectory.v1.Trajectory.Sample;
import trajectory.v1.Trajectory.TrajectoryComputed;

/** Unit: the edge check of a decoded trajectory. */
class TrajectoryValidationTest {
  private static Optional<String> problem(TrajectoryComputed t) {
    return TrajectoryValidation.problem(t);
  }

  @Test
  void acceptsAValidTrajectory() {
    assertEquals(Optional.empty(), problem(Trajectories.valid(3)));
  }

  @Test
  void rejectsAMissingOrMalformedLaunchId() {
    var t = Trajectories.valid(3);
    assertEquals(Optional.of("launch_id is empty"), problem(t.toBuilder().setLaunchId("").build()));
    assertEquals(
        Optional.of("launch_id is not a UUID"), problem(t.toBuilder().setLaunchId("abc").build()));
    assertEquals(
        Optional.of("launch_id is not a UUID"),
        problem(t.toBuilder().setLaunchId("1-1-1-1-1").build()));
    assertEquals(
        Optional.of("launch_id is not a UUID"),
        problem(t.toBuilder().setLaunchId("+0000000-0000-0000-0000-000000000000").build()));
    assertEquals(
        Optional.of("launch_id is not a UUID"),
        problem(t.toBuilder().setLaunchId("00000000-0000-0000-0000-00000000000\t").build()));
  }

  @Test
  void rejectsUnspecifiedEnums() {
    var t = Trajectories.valid(3);
    assertTrue(
        problem(
                t.toBuilder()
                    .setEndReason(TrajectoryComputed.EndReason.END_REASON_UNSPECIFIED)
                    .build())
            .orElseThrow()
            .startsWith("end_reason"));
    assertTrue(
        problem(
                t.toBuilder()
                    .setSamples(1, t.getSamples(1).toBuilder().setPhase(Sample.Phase.PHASE_UNSPECIFIED))
                    .build())
            .orElseThrow()
            .startsWith("samples[1].phase"));
    assertTrue(
        problem(t.toBuilder().setEndReasonValue(9).build()).orElseThrow().startsWith("end_reason"));
  }

  @Test
  void rejectsNoSamplesAndBadSeq() {
    var t = Trajectories.valid(3);
    assertEquals(Optional.of("no samples"), problem(t.toBuilder().clearSamples().build()));
    assertEquals(
        Optional.of("samples[2].seq is 3"),
        problem(t.toBuilder().setSamples(2, t.getSamples(2).toBuilder().setSeq(3)).build()));
    assertEquals(
        Optional.of("samples[0].seq is 4294967295"),
        problem(t.toBuilder().setSamples(0, t.getSamples(0).toBuilder().setSeq(-1)).build()));
  }

  @Test
  void rejectsMissingRequiredParts() {
    var t = Trajectories.valid(3);
    for (var broken :
        new TrajectoryComputed[] {
          t.toBuilder().clearAcceptedAt().build(),
          t.toBuilder().clearComputedAt().build(),
          t.toBuilder().clearRequest().build(),
          t.toBuilder().setRequest(t.getRequest().toBuilder().clearPosition()).build(),
          t.toBuilder().clearConfig().build()
        }) {
      assertTrue(problem(broken).isPresent(), broken.toString());
    }
  }
}
