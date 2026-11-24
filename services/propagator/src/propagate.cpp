#include "propagator/propagate.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <numbers>
#include <vector>

namespace propagator {

namespace {

using trajectory::v1::LaunchRequest;
using trajectory::v1::PropagationConfig;
using trajectory::v1::Sample;
using trajectory::v1::TrajectoryComputed;

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct State {
  Vec3 position;
  Vec3 velocity;
};

Vec3 vec(double x, double y, double z) { return {.x = x, .y = y, .z = z}; }

double radians(double degrees) { return degrees * std::numbers::pi / 180.0; }

void require(bool condition, const char* what) {
  if (!condition) {
    throw InvalidInput(what);
  }
}

void check_domain(const LaunchRequest& request, const PropagationConfig& config) {
  const auto& p = request.position();
  for (const double value :
       {request.mass_kg(), p.x_m(), p.y_m(), p.z_m(), request.azimuth_deg(),
        request.elevation_deg(), request.force_n(), request.burn_duration_s(),
        config.propagation_time_s(), config.sample_step_s(), config.gravity_mps2()}) {
    require(std::isfinite(value), "a value is not a finite number");
  }
  require(request.mass_kg() > 0.0, "mass_kg must be > 0");
  require(request.force_n() > 0.0, "force_n must be > 0");
  require(request.burn_duration_s() > 0.0, "burn_duration_s must be > 0");
  require(p.z_m() >= 0.0, "position.z_m must be >= 0");
  require(request.elevation_deg() > 0.0 && request.elevation_deg() < 90.0,
          "elevation_deg must be in (0, 90)");
  require(config.propagation_time_s() > 0.0, "propagation_time_s must be > 0");
  require(config.sample_step_s() > 0.0, "sample_step_s must be > 0");
  require(config.propagation_time_s() / config.sample_step_s() <= max_steps,
          "propagation_time_s / sample_step_s must be <= 100000");
  require(config.gravity_mps2() > 0.0, "gravity_mps2 must be > 0");
}

// The two constant-acceleration phases of a launch, in closed form.
class Motion {
 public:
  Motion(const LaunchRequest& request, double gravity)
      : start_(vec(request.position().x_m(), request.position().y_m(), request.position().z_m())),
        burn_s_(request.burn_duration_s()),
        gravity_(gravity) {
    const double azimuth = radians(request.azimuth_deg());
    const double elevation = radians(request.elevation_deg());
    const double thrust = request.force_n() / request.mass_kg();
    burn_acceleration_ = vec(thrust * std::cos(elevation) * std::sin(azimuth),
                             thrust * std::cos(elevation) * std::cos(azimuth),
                             (thrust * std::sin(elevation)) - gravity);
    burn_end_ = burn_state(burn_s_);
  }

  [[nodiscard]] double burn_s() const { return burn_s_; }
  [[nodiscard]] const Vec3& start() const { return start_; }

  [[nodiscard]] State at(double t) const { return t <= burn_s_ ? burn_state(t) : ballistic(t); }

  // No lift-off: on the ground and the force does not beat gravity.
  [[nodiscard]] bool lifts_off() const { return start_.z > 0.0 || burn_acceleration_.z > 0.0; }

  // The first t > 0 with z = 0 (exact root of the phase's quadratic). Needs lifts_off().
  [[nodiscard]] double ground_time() const {
    if (start_.z > 0.0 && burn_acceleration_.z < 0.0) {
      // z0 + a t^2 / 2 = 0
      const double t = std::sqrt(-2.0 * start_.z / burn_acceleration_.z);
      if (t <= burn_s_) {
        return t;
      }
    }
    // z1 + v1 tau - g tau^2 / 2 = 0, tau > 0; z1 > 0 here. The form without
    // cancellation for each sign of v1.
    const double z1 = burn_end_.position.z;
    const double v1 = burn_end_.velocity.z;
    const double root = std::sqrt((v1 * v1) + (2.0 * gravity_ * z1));
    const double tau = v1 >= 0.0 ? (v1 + root) / gravity_ : (2.0 * z1) / (root - v1);
    return burn_s_ + tau;
  }

  // The highest z on [0, end], from the closed form (the apex of the ballistic arc).
  [[nodiscard]] double max_height(double end) const {
    double highest = std::max(start_.z, at(std::min(burn_s_, end)).position.z);
    highest = std::max(highest, at(end).position.z);
    const double v1 = burn_end_.velocity.z;
    if (end > burn_s_ && v1 > 0.0 && burn_s_ + (v1 / gravity_) < end) {
      highest = std::max(highest, burn_end_.position.z + ((v1 * v1) / (2.0 * gravity_)));
    }
    return highest;
  }

 private:
  [[nodiscard]] State burn_state(double t) const {
    const Vec3& a = burn_acceleration_;
    const double half_t2 = 0.5 * t * t;
    return {.position = vec(start_.x + (a.x * half_t2), start_.y + (a.y * half_t2),
                            start_.z + (a.z * half_t2)),
            .velocity = vec(a.x * t, a.y * t, a.z * t)};
  }

  [[nodiscard]] State ballistic(double t) const {
    const double tau = t - burn_s_;
    const Vec3& p = burn_end_.position;
    const Vec3& v = burn_end_.velocity;
    return {.position = vec(p.x + (v.x * tau), p.y + (v.y * tau),
                            p.z + (v.z * tau) - (0.5 * gravity_ * tau * tau)),
            .velocity = vec(v.x, v.y, v.z - (gravity_ * tau))};
  }

  Vec3 start_;
  double burn_s_;
  double gravity_;
  Vec3 burn_acceleration_;
  State burn_end_;
};

// k * step while t < end, the burn-end time (when before the end) and the end;
// a burn-end or end time within same_time_s of a grid time replaces it.
std::vector<double> sample_times(double step, double burn, double end) {
  const bool burn_point = burn < end - same_time_s;
  std::vector<double> times;
  // PERF: up to max_steps + 2 values; reserve when it shows in a profile.
  for (std::uint32_t k = 0;; ++k) {
    const double t = static_cast<double>(k) * step;
    if (!(t < end)) {
      break;
    }
    const bool replaced =
        end - t <= same_time_s || (burn_point && std::abs(t - burn) <= same_time_s);
    if (!replaced) {
      times.push_back(t);
    }
  }
  if (burn_point) {
    times.insert(std::ranges::upper_bound(times, burn), burn);
  }
  times.push_back(end);
  return times;
}

}  // namespace

TrajectoryComputed propagate(const LaunchRequest& request, const PropagationConfig& config) {
  check_domain(request, config);
  const Motion motion(request, config.gravity_mps2());

  TrajectoryComputed result;
  *result.mutable_request() = request;
  *result.mutable_config() = config;

  double end = 0.0;
  bool on_ground = true;
  if (motion.lifts_off()) {
    const double ground = motion.ground_time();
    on_ground = ground <= config.propagation_time_s();
    end = on_ground ? ground : config.propagation_time_s();
  }
  result.set_end_reason(on_ground ? TrajectoryComputed::END_REASON_GROUND
                                  : TrajectoryComputed::END_REASON_TIME_LIMIT);

  const std::vector<double> times = sample_times(config.sample_step_s(), motion.burn_s(), end);
  result.mutable_samples()->Reserve(static_cast<int>(times.size()));
  std::uint32_t seq = 0;
  for (const double t : times) {
    State state = motion.at(t);
    if (on_ground && t == end) {
      state.position.z = 0.0;  // the ground point is on the ground, exactly
    }
    Sample* sample = result.add_samples();
    sample->set_seq(seq++);
    sample->set_t_s(t);
    sample->set_x_m(state.position.x);
    sample->set_y_m(state.position.y);
    sample->set_z_m(state.position.z);
    sample->set_vx_mps(state.velocity.x);
    sample->set_vy_mps(state.velocity.y);
    sample->set_vz_mps(state.velocity.z);
    sample->set_phase(t <= motion.burn_s() ? Sample::PHASE_BURN : Sample::PHASE_BALLISTIC);
  }

  const State last = motion.at(end);
  result.set_flight_time_s(end);
  result.set_max_height_m(motion.max_height(end));
  result.set_range_m(
      std::hypot(last.position.x - motion.start().x, last.position.y - motion.start().y));
  return result;
}

}  // namespace propagator
