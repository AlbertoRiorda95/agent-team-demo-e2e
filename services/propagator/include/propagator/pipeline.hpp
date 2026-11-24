// The launch use case of the propagator (docs/design/propagation.md > User
// flows 1 and 4), without NATS: decode and validate a `LaunchAccepted` at the
// edge, compute its trajectory, and build the messages the service publishes.
// The NATS adapter (nats_pipeline.hpp) only moves bytes and acks.
#pragma once

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "trajectory/v1/launch.pb.h"
#include "trajectory/v1/service.pb.h"
#include "trajectory/v1/trajectory.pb.h"

namespace propagator {

/// Subjects and names of proto/README.md > NATS subjects and Streams.
inline constexpr std::string_view launches_stream = "LAUNCHES";
inline constexpr std::string_view launches_accepted_subject = "launches.accepted";
inline constexpr std::string_view trajectories_computed_subject = "trajectories.computed";
inline constexpr std::string_view pipeline_errors_subject = "pipeline.errors";
inline constexpr std::string_view status_subject = "status.propagator";
/// The durable pull consumer on `LAUNCHES`, shared by the replicas.
inline constexpr std::string_view consumer_name = "propagator";

/// Ranges of a `PropagationConfig` (docs/design/propagation.md > Data and API).
inline constexpr double max_propagation_time_s = 3600.0;
inline constexpr double min_sample_step_s = 0.001;
inline constexpr double max_sample_step_s = 1.0;

/// The reason why `launch` is invalid, or nothing when it is valid: an empty
/// `launch_id`, a missing request, position or config, a value that is not
/// finite or out of the ranges of docs/api/openapi.yaml and of the config
/// (including the sample cap), a gravity that is not positive.
[[nodiscard]] std::optional<std::string> validate_launch(
    const trajectory::v1::LaunchAccepted& launch);

/// What to do with one `LaunchAccepted`.
struct LaunchOutcome {
  enum class Kind : std::uint8_t {
    computed,  ///< publish `trajectory` on trajectories.computed, then ack
    rejected,  ///< publish `error` on pipeline.errors, then terminate
  };
  Kind kind = Kind::rejected;
  /// The launch id of the input, possibly empty when rejected.
  std::string launch_id;
  trajectory::v1::TrajectoryComputed trajectory;
  trajectory::v1::PipelineError error;
};

/// Decodes `payload` (the binary Protobuf of a `LaunchAccepted`), validates
/// it and computes its trajectory with the config snapshot it carries.
/// `now` stamps `computed_at` or `occurred_at`. Never throws on bad input:
/// that is a `rejected` outcome.
[[nodiscard]] LaunchOutcome handle_launch(std::string_view payload,
                                          std::chrono::system_clock::time_point now);

/// The heartbeat on `status.propagator`: `STATE_OK` when `degraded_reason`
/// is empty, else `STATE_DEGRADED` with it as the detail.
[[nodiscard]] trajectory::v1::ServiceStatus make_status(std::string_view instance,
                                                        std::string_view degraded_reason,
                                                        std::uint64_t config_version,
                                                        std::chrono::system_clock::time_point now);

}  // namespace propagator
