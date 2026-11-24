// The physics of the propagator (docs/design/propagation.md > User flows,
// "Physics"): a point mass pushed by a constant force for the burn, then
// ballistic, in vacuum with constant gravity. Both phases have a constant
// acceleration, so every state is a closed form; nothing is integrated.
#pragma once

#include <stdexcept>
#include <string>

#include "trajectory/v1/launch.pb.h"
#include "trajectory/v1/trajectory.pb.h"

namespace propagator {

/// Two times closer than this (in seconds) are the same sample time: a burn-end
/// or end point this close to a grid point replaces it.
inline constexpr double same_time_s = 1e-9;

/// Most samples a trajectory may have: propagation_time_s / sample_step_s is
/// at most this (the sample cap, proto/README.md).
inline constexpr double max_steps = 100'000.0;

/// Thrown by `propagate` when the request or the config is outside the domain
/// of the physics (not finite, mass or force not positive, z < 0...). The
/// service validates its input at the edge first; this keeps the function
/// total and its loops bounded.
class InvalidInput : public std::invalid_argument {
 public:
  explicit InvalidInput(const std::string& what) : std::invalid_argument(what) {}
};

/// Computes the trajectory of `request` with `config`.
///
/// The result holds `request`, `config`, `end_reason`, `flight_time_s`,
/// `max_height_m`, `range_m` and `samples`; `launch_id`, `accepted_at` and
/// `computed_at` are left for the caller. Deterministic: the same input gives
/// the same output, bit for bit.
///
/// Rules: frame ENU, z up; force direction (cos e sin az, cos e cos az, sin e);
/// a = F/m u - g z during [0, burn], -g z after. The end is the first t > 0
/// with z = 0 (exact root, END_REASON_GROUND) or propagation_time_s
/// (END_REASON_TIME_LIMIT). Samples at k * sample_step_s while t < end, plus
/// the burn-end point (when before the end) and the end point. Without
/// lift-off (z = 0 and F sin e <= m g): one sample at t = 0, END_REASON_GROUND.
///
/// Throws `InvalidInput` when the input is outside the domain.
[[nodiscard]] trajectory::v1::TrajectoryComputed propagate(
    const trajectory::v1::LaunchRequest& request, const trajectory::v1::PropagationConfig& config);

}  // namespace propagator
