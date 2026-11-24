package trajectory.store;

/** The NATS names the store uses (proto/README.md > NATS subjects, Streams). */
public final class Subjects {
  private Subjects() {}

  /** The service name on the subjects. */
  public static final String SERVICE = "store";
  /** Input: {@code trajectory.v1.TrajectoryComputed}. */
  public static final String TRAJECTORIES_COMPUTED = "trajectories.computed";
  /** Output: {@code trajectory.v1.TrajectoryStored}. */
  public static final String TRAJECTORIES_STORED = "trajectories.stored";
  /** Output: {@code trajectory.v1.PipelineError}. */
  public static final String PIPELINE_ERRORS = "pipeline.errors";
  /** Output: {@code trajectory.v1.ServiceStatus}, every 5 s (core NATS). */
  public static final String STATUS = "status." + SERVICE;
  /** The stream of {@code trajectories.>}. */
  public static final String TRAJECTORIES_STREAM = "TRAJECTORIES";
  /** The durable pull consumer, shared by the replicas. */
  public static final String DURABLE = "store";
}
