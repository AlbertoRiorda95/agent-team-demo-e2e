// Unit tests of propagator::propagate (docs/design/propagation.md > Test seams,
// "Library") against the closed-form vacuum ballistics, written here
// independently of the implementation.
//
// Tolerance: 1e-9 relative (|actual - expected| <= 1e-9 * |expected|), with an
// absolute floor of 1e-9 for values below 1 in magnitude (a relative bound
// means nothing near zero). Times of the samples are compared exactly where
// the rules make them exact (grid k * step, burn end, ground root).
#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <numbers>
#include <string>
#include <vector>

#include "propagator/propagate.hpp"

namespace {

using trajectory::v1::LaunchRequest;
using trajectory::v1::PropagationConfig;
using trajectory::v1::Sample;
using trajectory::v1::TrajectoryComputed;

constexpr double tolerance = 1e-9;
constexpr double standard_gravity = 9.80665;

struct Launch {
  double mass_kg = 1.0;
  double x_m = 0.0;
  double y_m = 0.0;
  double z_m = 0.0;
  double azimuth_deg = 0.0;
  double elevation_deg = 45.0;
  double force_n = 50.0;
  double burn_s = 2.0;
  double propagation_time_s = 60.0;
  double sample_step_s = 0.01;
};

LaunchRequest request_of(const Launch& l) {
  LaunchRequest r;
  r.set_mass_kg(l.mass_kg);
  r.mutable_position()->set_x_m(l.x_m);
  r.mutable_position()->set_y_m(l.y_m);
  r.mutable_position()->set_z_m(l.z_m);
  r.set_azimuth_deg(l.azimuth_deg);
  r.set_elevation_deg(l.elevation_deg);
  r.set_force_n(l.force_n);
  r.set_burn_duration_s(l.burn_s);
  return r;
}

PropagationConfig config_of(const Launch& l) {
  PropagationConfig c;
  c.set_propagation_time_s(l.propagation_time_s);
  c.set_sample_step_s(l.sample_step_s);
  c.set_gravity_mps2(standard_gravity);
  c.set_config_version(3);
  return c;
}

// The closed form: x(t) = x0 + a t^2 / 2 during the burn; after it the burn-end
// state moves with -g only.
struct Expected {
  double x, y, z, vx, vy, vz;
};

struct Closed {
  explicit Closed(const Launch& l) : l(l) {
    const double az = l.azimuth_deg * std::numbers::pi / 180.0;
    const double el = l.elevation_deg * std::numbers::pi / 180.0;
    const double f = l.force_n / l.mass_kg;
    ax = f * std::cos(el) * std::sin(az);
    ay = f * std::cos(el) * std::cos(az);
    az_up = f * std::sin(el) - standard_gravity;
  }

  [[nodiscard]] Expected at(double t) const {
    const double tb = std::min(t, l.burn_s);
    const double tau = std::max(0.0, t - l.burn_s);
    const double g = tau > 0.0 ? standard_gravity : 0.0;
    return {l.x_m + 0.5 * ax * tb * tb + ax * tb * tau,
            l.y_m + 0.5 * ay * tb * tb + ay * tb * tau,
            l.z_m + 0.5 * az_up * tb * tb + az_up * tb * tau - 0.5 * g * tau * tau,
            ax * tb,
            ay * tb,
            az_up * tb - g * tau};
  }

  // The positive root of A t^2 + B t + C = 0 with the textbook formula.
  static double root(double a, double b, double c) {
    const double d = std::sqrt(b * b - 4.0 * a * c);
    return std::max((-b + d) / (2.0 * a), (-b - d) / (2.0 * a));
  }

  // Ground time: in the burn when z0 + a t^2/2 reaches 0 first, else in the arc.
  [[nodiscard]] double ground_time() const {
    if (az_up < 0.0) {
      const double t = std::sqrt(2.0 * l.z_m / -az_up);
      if (t <= l.burn_s) {
        return t;
      }
    }
    const Expected b = at(l.burn_s);
    return l.burn_s + root(-0.5 * standard_gravity, b.vz, b.z);
  }

  Launch l;
  double ax = 0.0;
  double ay = 0.0;
  double az_up = 0.0;
};

void expect_close(double actual, double expected, const std::string& what) {
  EXPECT_NEAR(actual, expected, tolerance * std::max(1.0, std::abs(expected))) << what;
}

std::size_t count_at(const TrajectoryComputed& tr, double t) {
  return static_cast<std::size_t>(std::count_if(tr.samples().begin(), tr.samples().end(),
                                                [t](const Sample& s) { return s.t_s() == t; }));
}

// Every rule that holds for any trajectory.
void expect_rules(const Launch& l, const TrajectoryComputed& tr) {
  const Closed closed(l);
  ASSERT_GT(tr.samples_size(), 0);
  const double end = tr.flight_time_s();
  EXPECT_EQ(tr.samples(tr.samples_size() - 1).t_s(), end);
  EXPECT_EQ(tr.samples(0).t_s(), 0.0);
  EXPECT_EQ(count_at(tr, end), 1U);
  if (l.burn_s < end) {
    EXPECT_EQ(count_at(tr, l.burn_s), 1U) << "the burn-end point is present once";
  }

  double highest = -1.0;
  for (int i = 0; i < tr.samples_size(); ++i) {
    const Sample& s = tr.samples(i);
    const std::string where = "sample " + std::to_string(i) + " t=" + std::to_string(s.t_s());
    EXPECT_EQ(s.seq(), static_cast<unsigned>(i)) << where;
    if (i > 0) {
      EXPECT_GT(s.t_s() - tr.samples(i - 1).t_s(), propagator::same_time_s) << where;
    }
    const bool special = s.t_s() == l.burn_s || s.t_s() == end;
    if (!special) {
      const double k = std::round(s.t_s() / l.sample_step_s);
      EXPECT_EQ(s.t_s(), k * l.sample_step_s) << where << ": a grid time";
    }
    const Expected e = closed.at(s.t_s());
    expect_close(s.x_m(), e.x, where + " x");
    expect_close(s.y_m(), e.y, where + " y");
    if (!(tr.end_reason() == TrajectoryComputed::END_REASON_GROUND && s.t_s() == end)) {
      expect_close(s.z_m(), e.z, where + " z");
    }
    expect_close(s.vx_mps(), e.vx, where + " vx");
    expect_close(s.vy_mps(), e.vy, where + " vy");
    expect_close(s.vz_mps(), e.vz, where + " vz");
    EXPECT_EQ(s.phase(), s.t_s() <= l.burn_s ? Sample::PHASE_BURN : Sample::PHASE_BALLISTIC)
        << where;
    highest = std::max(highest, s.z_m());
  }

  const Expected last = closed.at(end);
  expect_close(tr.range_m(), std::hypot(last.x - l.x_m, last.y - l.y_m), "range");
  EXPECT_GE(tr.max_height_m(), highest) << "the apex is at least the highest sample";
  EXPECT_EQ(tr.request().SerializeAsString(), request_of(l).SerializeAsString());
  EXPECT_EQ(tr.config().SerializeAsString(), config_of(l).SerializeAsString());
}

void expect_ground(const Launch& l, const TrajectoryComputed& tr) {
  ASSERT_EQ(tr.end_reason(), TrajectoryComputed::END_REASON_GROUND);
  expect_close(tr.flight_time_s(), Closed(l).ground_time(), "ground time = quadratic root");
  EXPECT_EQ(tr.samples(tr.samples_size() - 1).z_m(), 0.0) << "the ground point has z = 0 exactly";
}

// The apex of the ballistic arc: z1 + v1^2 / (2 g), when it is reached.
double ballistic_apex(const Launch& l) {
  const Expected b = Closed(l).at(l.burn_s);
  return b.z + b.vz * b.vz / (2.0 * standard_gravity);
}

TEST(Propagate, VerticalIshLaunchLandsAfterItsApex) {
  const Launch l{.azimuth_deg = 30.0, .elevation_deg = 89.0, .force_n = 50.0, .burn_s = 2.0};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  expect_ground(l, tr);
  expect_close(tr.max_height_m(), ballistic_apex(l), "max height = apex");
}

TEST(Propagate, ShallowLaunchLands) {
  const Launch l{.azimuth_deg = 250.0, .elevation_deg = 10.0, .force_n = 100.0, .burn_s = 1.0};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  expect_ground(l, tr);
  expect_close(tr.max_height_m(), ballistic_apex(l), "max height = apex");
}

TEST(Propagate, LaunchFromAboveTheGroundLands) {
  const Launch l{.x_m = 10.0,
                 .y_m = -20.0,
                 .z_m = 100.0,
                 .azimuth_deg = 135.0,
                 .elevation_deg = 45.0,
                 .force_n = 20.0,
                 .burn_s = 3.0,
                 .sample_step_s = 0.05};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  expect_ground(l, tr);
  expect_close(tr.max_height_m(), ballistic_apex(l), "max height = apex");
}

TEST(Propagate, LandingDuringTheBurnHasOnlyBurnSamples) {
  const Launch l{.z_m = 50.0, .elevation_deg = 10.0, .force_n = 10.0, .burn_s = 10.0};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  expect_ground(l, tr);
  EXPECT_LT(tr.flight_time_s(), l.burn_s);
  for (const auto& s : tr.samples()) {
    EXPECT_EQ(s.phase(), Sample::PHASE_BURN);
  }
  EXPECT_EQ(tr.max_height_m(), 50.0) << "falling from the start: the start is the highest";
}

TEST(Propagate, BurnLongerThanThePropagationTimeEndsOnTheTimeLimit) {
  const Launch l{.elevation_deg = 80.0,
                 .force_n = 30.0,
                 .burn_s = 100.0,
                 .propagation_time_s = 10.0,
                 .sample_step_s = 0.1};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  EXPECT_EQ(tr.end_reason(), TrajectoryComputed::END_REASON_TIME_LIMIT);
  EXPECT_EQ(tr.flight_time_s(), 10.0);
  EXPECT_EQ(tr.samples_size(), 101);
  for (const auto& s : tr.samples()) {
    EXPECT_EQ(s.phase(), Sample::PHASE_BURN);
  }
  expect_close(tr.max_height_m(), Closed(l).at(10.0).z, "still climbing: the end is the highest");
}

TEST(Propagate, NoLiftOffGivesOneSampleOnTheGround) {
  const Launch l{.elevation_deg = 5.0, .force_n = 10.0};  // F sin e < m g
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  ASSERT_EQ(tr.samples_size(), 1);
  EXPECT_EQ(tr.end_reason(), TrajectoryComputed::END_REASON_GROUND);
  EXPECT_EQ(tr.flight_time_s(), 0.0);
  EXPECT_EQ(tr.max_height_m(), 0.0);
  EXPECT_EQ(tr.range_m(), 0.0);
  const Sample& s = tr.samples(0);
  EXPECT_EQ(s.seq(), 0U);
  EXPECT_EQ(s.t_s(), 0.0);
  EXPECT_EQ(s.z_m(), 0.0);
  EXPECT_EQ(s.vz_mps(), 0.0);
}

TEST(Propagate, DefaultsOnALaunchThatDoesNotLandGive6001Samples) {
  // burn end at 10 s: on the grid (1000 * 0.01 is within 1e-9 s of it)
  const Launch l{.elevation_deg = 80.0, .force_n = 100.0, .burn_s = 10.0};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  EXPECT_EQ(tr.end_reason(), TrajectoryComputed::END_REASON_TIME_LIMIT);
  EXPECT_EQ(tr.samples_size(), 6001);
  EXPECT_EQ(tr.flight_time_s(), 60.0);
  expect_close(tr.max_height_m(), Closed(l).at(60.0).z,
               "apex after the end: the end is the highest");
}

TEST(Propagate, BurnEndOffTheGridAddsOnePoint) {
  const Launch l{.elevation_deg = 80.0, .force_n = 100.0, .burn_s = 10.005};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  EXPECT_EQ(tr.samples_size(), 6002);
  const auto& burn_end = tr.samples(1001);
  EXPECT_EQ(burn_end.t_s(), 10.005);
  EXPECT_EQ(burn_end.phase(), Sample::PHASE_BURN);
  EXPECT_EQ(tr.samples(1002).phase(), Sample::PHASE_BALLISTIC);
}

TEST(Propagate, PointsWithinANanosecondOfTheGridReplaceIt) {
  const Launch l{.elevation_deg = 80.0,
                 .force_n = 100.0,
                 .burn_s = 1.0 + 5e-10,
                 .propagation_time_s = 2.0 + 5e-10,
                 .sample_step_s = 0.5};
  const auto tr = propagator::propagate(request_of(l), config_of(l));
  expect_rules(l, tr);
  std::vector<double> times;
  for (const auto& s : tr.samples()) {
    times.push_back(s.t_s());
  }
  EXPECT_EQ(times, (std::vector<double>{0.0, 0.5, 1.0 + 5e-10, 1.5, 2.0 + 5e-10}));
}

TEST(Propagate, IsDeterministic) {
  const Launch l{.z_m = 3.0, .azimuth_deg = 359.0, .elevation_deg = 60.0, .force_n = 40.0};
  const auto first = propagator::propagate(request_of(l), config_of(l));
  const auto second = propagator::propagate(request_of(l), config_of(l));
  EXPECT_EQ(first.SerializeAsString(), second.SerializeAsString());
}

TEST(Propagate, RejectsInputOutsideTheDomain) {
  const Launch ok{};
  auto bad_request = [&](auto change) {
    LaunchRequest r = request_of(ok);
    change(r);
    return r;
  };
  auto bad_config = [&](auto change) {
    PropagationConfig c = config_of(ok);
    change(c);
    return c;
  };
  const auto config = config_of(ok);
  const auto request = request_of(ok);
  using propagator::InvalidInput;
  EXPECT_THROW(
      (void)propagator::propagate(bad_request([](auto& r) { r.set_mass_kg(0.0); }), config),
      InvalidInput);
  EXPECT_THROW(
      (void)propagator::propagate(bad_request([](auto& r) { r.set_force_n(NAN); }), config),
      InvalidInput);
  EXPECT_THROW((void)propagator::propagate(
                   bad_request([](auto& r) { r.mutable_position()->set_z_m(-1.0); }), config),
               InvalidInput);
  EXPECT_THROW(
      (void)propagator::propagate(bad_request([](auto& r) { r.set_elevation_deg(90.0); }), config),
      InvalidInput);
  EXPECT_THROW(
      (void)propagator::propagate(request, bad_config([](auto& c) { c.set_sample_step_s(0.0); })),
      InvalidInput);
  EXPECT_THROW((void)propagator::propagate(request, bad_config([](auto& c) {
                                             c.set_propagation_time_s(1000.0);
                                             c.set_sample_step_s(0.001);
                                           })),
               InvalidInput)
      << "over the sample cap";
  EXPECT_THROW(
      (void)propagator::propagate(request, bad_config([](auto& c) { c.set_gravity_mps2(0.0); })),
      InvalidInput);
}

}  // namespace
