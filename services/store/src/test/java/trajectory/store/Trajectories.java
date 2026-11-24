package trajectory.store;

import com.google.protobuf.Timestamp;
import java.util.UUID;
import trajectory.v1.Launch.LaunchRequest;
import trajectory.v1.Launch.Position;
import trajectory.v1.Launch.PropagationConfig;
import trajectory.v1.Trajectory.Sample;
import trajectory.v1.Trajectory.TrajectoryComputed;

/** Test messages: a valid {@code TrajectoryComputed} with {@code n} samples. */
final class Trajectories {
  private Trajectories() {}

  static TrajectoryComputed valid(int n) {
    return valid(UUID.randomUUID().toString(), n);
  }

  static TrajectoryComputed valid(String launchId, int n) {
    TrajectoryComputed.Builder b =
        TrajectoryComputed.newBuilder()
            .setLaunchId(launchId)
            .setAcceptedAt(Timestamp.newBuilder().setSeconds(1_795_000_000L).setNanos(123_456_000))
            .setComputedAt(Timestamp.newBuilder().setSeconds(1_795_000_001L).setNanos(500_000_000))
            .setRequest(
                LaunchRequest.newBuilder()
                    .setMassKg(2.5)
                    .setPosition(Position.newBuilder().setXM(1.25).setYM(-3.5).setZM(0))
                    .setAzimuthDeg(45)
                    .setElevationDeg(60)
                    .setForceN(100)
                    .setBurnDurationS(1.5))
            .setConfig(
                PropagationConfig.newBuilder()
                    .setPropagationTimeS(60)
                    .setSampleStepS(0.01)
                    .setGravityMps2(9.80665)
                    .setConfigVersion(3))
            .setEndReason(TrajectoryComputed.EndReason.END_REASON_GROUND)
            .setFlightTimeS(n * 0.01)
            .setMaxHeightM(123.456)
            .setRangeM(789.0123);
    for (int i = 0; i < n; i++) {
      double t = i * 0.01;
      b.addSamples(
          Sample.newBuilder()
              .setSeq(i)
              .setTS(t)
              .setXM(1.25 + 0.1 * i)
              .setYM(-3.5 + 1e-7 * i)
              .setZM(t * (100 - t))
              .setVxMps(10.0 / 3)
              .setVyMps(-1e-300)
              .setVzMps(100 - 2 * t)
              .setPhase(t < 1.5 ? Sample.Phase.PHASE_BURN : Sample.Phase.PHASE_BALLISTIC));
    }
    return b.build();
  }
}
