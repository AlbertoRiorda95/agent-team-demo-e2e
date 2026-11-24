#include "propagator/pipeline.hpp"

#include <google/protobuf/timestamp.pb.h>

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <string>
#include <utility>

#include "propagator/propagate.hpp"
#include "propagator/propagator.hpp"

namespace propagator {

namespace {

using trajectory::v1::LaunchAccepted;
using trajectory::v1::ServiceStatus;

void stamp(google::protobuf::Timestamp* timestamp, std::chrono::system_clock::time_point now) {
  const auto since_epoch = now.time_since_epoch();
  const auto seconds = std::chrono::floor<std::chrono::seconds>(since_epoch);
  const auto nanos = std::chrono::duration_cast<std::chrono::nanoseconds>(since_epoch - seconds);
  timestamp->set_seconds(seconds.count());
  timestamp->set_nanos(static_cast<std::int32_t>(nanos.count()));
}

bool all_finite(std::initializer_list<double> values) {
  return std::ranges::all_of(values, [](double value) { return std::isfinite(value); });
}

LaunchOutcome rejected(std::string launch_id, std::string message,
                       std::chrono::system_clock::time_point now) {
  LaunchOutcome outcome;
  outcome.kind = LaunchOutcome::Kind::rejected;
  outcome.launch_id = std::move(launch_id);
  outcome.error.set_launch_id(outcome.launch_id);
  outcome.error.set_service("propagator");
  outcome.error.set_subject(std::string{launches_accepted_subject});
  outcome.error.set_message(std::move(message));
  stamp(outcome.error.mutable_occurred_at(), now);
  return outcome;
}

}  // namespace

std::optional<std::string> validate_launch(const LaunchAccepted& launch) {
  if (launch.launch_id().empty()) {
    return "launch_id is empty";
  }
  if (!launch.has_request()) {
    return "request is missing";
  }
  if (!launch.request().has_position()) {
    return "request.position is missing";
  }
  if (!launch.has_config()) {
    return "config is missing";
  }
  const auto& r = launch.request();
  const auto& p = r.position();
  const auto& c = launch.config();
  // Every value is finite below, so the comparisons are total.
  if (!all_finite({r.mass_kg(), p.x_m(), p.y_m(), p.z_m(), r.azimuth_deg(), r.elevation_deg(),
                   r.force_n(), r.burn_duration_s(), c.propagation_time_s(), c.sample_step_s(),
                   c.gravity_mps2()})) {
    return "a value is not a finite number";
  }
  // The ranges of docs/api/openapi.yaml (LaunchRequest, Position).
  if (r.mass_kg() <= 0.0) {
    return "request.mass_kg must be > 0";
  }
  if (p.z_m() < 0.0) {
    return "request.position.z_m must be >= 0";
  }
  if (r.azimuth_deg() < 0.0 || r.azimuth_deg() >= 360.0) {
    return "request.azimuth_deg must be in [0, 360)";
  }
  if (r.elevation_deg() <= 0.0 || r.elevation_deg() >= 90.0) {
    return "request.elevation_deg must be in (0, 90)";
  }
  if (r.force_n() <= 0.0) {
    return "request.force_n must be > 0";
  }
  if (r.burn_duration_s() <= 0.0) {
    return "request.burn_duration_s must be > 0";
  }
  // The ranges of the propagation config (docs/design/propagation.md > Data and API).
  if (c.propagation_time_s() <= 0.0 || c.propagation_time_s() > max_propagation_time_s) {
    return "config.propagation_time_s must be in (0, 3600]";
  }
  if (c.sample_step_s() < min_sample_step_s || c.sample_step_s() > max_sample_step_s) {
    return "config.sample_step_s must be in [0.001, 1]";
  }
  if (c.propagation_time_s() / c.sample_step_s() > max_steps) {
    return "config.propagation_time_s / config.sample_step_s must be <= 100000";
  }
  if (c.gravity_mps2() <= 0.0) {
    return "config.gravity_mps2 must be > 0";
  }
  return std::nullopt;
}

LaunchOutcome handle_launch(std::string_view payload, std::chrono::system_clock::time_point now) {
  LaunchAccepted launch;
  if (!launch.ParseFromArray(payload.data(), static_cast<int>(payload.size()))) {
    return rejected({}, "the message is not a trajectory.v1.LaunchAccepted", now);
  }
  if (const auto reason = validate_launch(launch)) {
    return rejected(launch.launch_id(), *reason, now);
  }

  LaunchOutcome outcome;
  try {
    outcome.trajectory = propagate(launch.request(), launch.config());
  } catch (const InvalidInput& error) {
    // validate_launch covers the domain of propagate; kept as a safety net.
    return rejected(launch.launch_id(), error.what(), now);
  }
  outcome.kind = LaunchOutcome::Kind::computed;
  outcome.launch_id = launch.launch_id();
  outcome.trajectory.set_launch_id(launch.launch_id());
  *outcome.trajectory.mutable_accepted_at() = launch.accepted_at();
  stamp(outcome.trajectory.mutable_computed_at(), now);
  return outcome;
}

ServiceStatus make_status(std::string_view instance, std::string_view degraded_reason,
                          std::uint64_t config_version, std::chrono::system_clock::time_point now) {
  ServiceStatus status;
  status.set_service("propagator");
  status.set_instance(std::string{instance});
  status.set_state(degraded_reason.empty() ? ServiceStatus::STATE_OK
                                           : ServiceStatus::STATE_DEGRADED);
  status.set_detail(std::string{degraded_reason});
  status.set_version(std::string{version()});
  status.set_config_version(config_version);
  stamp(status.mutable_sent_at(), now);
  return status;
}

}  // namespace propagator
