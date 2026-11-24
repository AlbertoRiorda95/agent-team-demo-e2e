// Unit tests of the launch use case (propagator/pipeline.hpp): the edge
// validation of a LaunchAccepted, the outcome of handle_launch and the
// heartbeat message, without NATS. The NATS flow is in nats_integration_test.
#include <gtest/gtest.h>

#include <chrono>
#include <functional>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#include "propagator/pipeline.hpp"
#include "propagator/propagate.hpp"

namespace {

using propagator::LaunchOutcome;
using trajectory::v1::LaunchAccepted;
using trajectory::v1::ServiceStatus;

const auto now = std::chrono::system_clock::time_point{std::chrono::seconds{1'800'000'000}} +
                 std::chrono::nanoseconds{250};

LaunchAccepted valid_launch() {
  LaunchAccepted launch;
  launch.set_launch_id("0b9f6a52-8d4e-4c1a-9d43-1f0e7a2b3c4d");
  launch.mutable_accepted_at()->set_seconds(1'799'999'999);
  auto* r = launch.mutable_request();
  r->set_mass_kg(1.0);
  r->mutable_position()->set_x_m(10.0);
  r->mutable_position()->set_y_m(-5.0);
  r->mutable_position()->set_z_m(0.0);
  r->set_azimuth_deg(30.0);
  r->set_elevation_deg(60.0);
  r->set_force_n(50.0);
  r->set_burn_duration_s(2.0);
  auto* c = launch.mutable_config();
  c->set_propagation_time_s(60.0);
  c->set_sample_step_s(0.01);
  c->set_gravity_mps2(9.80665);
  c->set_config_version(4);
  return launch;
}

TEST(ValidateLaunch, AcceptsAValidLaunch) {
  EXPECT_EQ(propagator::validate_launch(valid_launch()), std::nullopt);
}

TEST(ValidateLaunch, AcceptsTheBoundsOfTheRanges) {
  auto launch = valid_launch();
  launch.mutable_request()->set_azimuth_deg(0.0);
  launch.mutable_config()->set_propagation_time_s(100.0);
  launch.mutable_config()->set_sample_step_s(0.001);  // 100000 steps: the cap
  EXPECT_EQ(propagator::validate_launch(launch), std::nullopt);
  launch.mutable_config()->set_propagation_time_s(3600.0);
  launch.mutable_config()->set_sample_step_s(1.0);
  EXPECT_EQ(propagator::validate_launch(launch), std::nullopt);
}

TEST(ValidateLaunch, RejectsEveryInvalidValue) {
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  const std::vector<std::pair<std::string, std::function<void(LaunchAccepted&)>>> cases = {
      {"launch_id is empty", [](auto& l) { l.clear_launch_id(); }},
      {"request is missing", [](auto& l) { l.clear_request(); }},
      {"request.position is missing", [](auto& l) { l.mutable_request()->clear_position(); }},
      {"config is missing", [](auto& l) { l.clear_config(); }},
      {"a value is not a finite number",
       [&](auto& l) { l.mutable_request()->mutable_position()->set_x_m(nan); }},
      {"a value is not a finite number",
       [&](auto& l) { l.mutable_config()->set_gravity_mps2(inf); }},
      {"request.mass_kg must be > 0", [](auto& l) { l.mutable_request()->set_mass_kg(0.0); }},
      {"request.position.z_m must be >= 0",
       [](auto& l) { l.mutable_request()->mutable_position()->set_z_m(-0.1); }},
      {"request.azimuth_deg must be in [0, 360)",
       [](auto& l) { l.mutable_request()->set_azimuth_deg(360.0); }},
      {"request.azimuth_deg must be in [0, 360)",
       [](auto& l) { l.mutable_request()->set_azimuth_deg(-1.0); }},
      {"request.elevation_deg must be in (0, 90)",
       [](auto& l) { l.mutable_request()->set_elevation_deg(0.0); }},
      {"request.elevation_deg must be in (0, 90)",
       [](auto& l) { l.mutable_request()->set_elevation_deg(90.0); }},
      {"request.force_n must be > 0", [](auto& l) { l.mutable_request()->set_force_n(-1.0); }},
      {"request.burn_duration_s must be > 0",
       [](auto& l) { l.mutable_request()->set_burn_duration_s(0.0); }},
      {"config.propagation_time_s must be in (0, 3600]",
       [](auto& l) { l.mutable_config()->set_propagation_time_s(0.0); }},
      {"config.propagation_time_s must be in (0, 3600]",
       [](auto& l) { l.mutable_config()->set_propagation_time_s(3600.5); }},
      {"config.sample_step_s must be in [0.001, 1]",
       [](auto& l) { l.mutable_config()->set_sample_step_s(0.0009); }},
      {"config.sample_step_s must be in [0.001, 1]",
       [](auto& l) { l.mutable_config()->set_sample_step_s(1.5); }},
      {"config.propagation_time_s / config.sample_step_s must be <= 100000",
       [](auto& l) {
         l.mutable_config()->set_propagation_time_s(101.0);
         l.mutable_config()->set_sample_step_s(0.001);
       }},
      {"config.gravity_mps2 must be > 0",
       [](auto& l) { l.mutable_config()->set_gravity_mps2(0.0); }},
  };
  for (const auto& [reason, mutate] : cases) {
    auto launch = valid_launch();
    mutate(launch);
    EXPECT_EQ(propagator::validate_launch(launch), reason) << reason;
  }
}

TEST(HandleLaunch, ComputesTheTrajectoryWithTheSnapshotOfTheMessage) {
  const auto launch = valid_launch();
  const LaunchOutcome outcome = propagator::handle_launch(launch.SerializeAsString(), now);

  ASSERT_EQ(outcome.kind, LaunchOutcome::Kind::computed);
  EXPECT_EQ(outcome.launch_id, launch.launch_id());
  const auto& t = outcome.trajectory;
  EXPECT_EQ(t.launch_id(), launch.launch_id());
  EXPECT_EQ(t.accepted_at().seconds(), launch.accepted_at().seconds());
  EXPECT_EQ(t.computed_at().seconds(), 1'800'000'000);
  EXPECT_EQ(t.computed_at().nanos(), 250);
  EXPECT_EQ(t.request().SerializeAsString(), launch.request().SerializeAsString());
  EXPECT_EQ(t.config().SerializeAsString(), launch.config().SerializeAsString());

  // The physics is the library's (propagate_test): the outcome carries it as is.
  auto expected = propagator::propagate(launch.request(), launch.config());
  expected.set_launch_id(launch.launch_id());
  *expected.mutable_accepted_at() = launch.accepted_at();
  *expected.mutable_computed_at() = t.computed_at();
  EXPECT_EQ(t.SerializeAsString(), expected.SerializeAsString());
}

TEST(HandleLaunch, IsDeterministic) {
  const std::string payload = valid_launch().SerializeAsString();
  EXPECT_EQ(propagator::handle_launch(payload, now).trajectory.SerializeAsString(),
            propagator::handle_launch(payload, now).trajectory.SerializeAsString());
}

TEST(HandleLaunch, RejectsBytesThatDoNotDecode) {
  const LaunchOutcome outcome = propagator::handle_launch("\xff\xff\xff not protobuf", now);
  ASSERT_EQ(outcome.kind, LaunchOutcome::Kind::rejected);
  EXPECT_EQ(outcome.launch_id, "");
  EXPECT_EQ(outcome.error.service(), "propagator");
  EXPECT_EQ(outcome.error.subject(), "launches.accepted");
  EXPECT_EQ(outcome.error.message(), "the message is not a trajectory.v1.LaunchAccepted");
  EXPECT_EQ(outcome.error.occurred_at().seconds(), 1'800'000'000);
}

TEST(HandleLaunch, RejectsAnInvalidLaunchWithItsId) {
  auto launch = valid_launch();
  launch.mutable_request()->set_mass_kg(-2.0);
  const LaunchOutcome outcome = propagator::handle_launch(launch.SerializeAsString(), now);
  ASSERT_EQ(outcome.kind, LaunchOutcome::Kind::rejected);
  EXPECT_EQ(outcome.launch_id, launch.launch_id());
  EXPECT_EQ(outcome.error.launch_id(), launch.launch_id());
  EXPECT_EQ(outcome.error.message(), "request.mass_kg must be > 0");
  EXPECT_EQ(outcome.trajectory.samples_size(), 0);
}

TEST(HandleLaunch, RejectsAnEmptyMessage) {
  // An empty payload decodes to an empty LaunchAccepted: no launch_id.
  const LaunchOutcome outcome = propagator::handle_launch("", now);
  ASSERT_EQ(outcome.kind, LaunchOutcome::Kind::rejected);
  EXPECT_EQ(outcome.error.message(), "launch_id is empty");
}

TEST(MakeStatus, OkOrDegradedWithTheReason) {
  const ServiceStatus ok = propagator::make_status("pod-1", "", 7, now);
  EXPECT_EQ(ok.service(), "propagator");
  EXPECT_EQ(ok.instance(), "pod-1");
  EXPECT_EQ(ok.state(), ServiceStatus::STATE_OK);
  EXPECT_EQ(ok.detail(), "");
  EXPECT_EQ(ok.version(), "0.0.0");
  EXPECT_EQ(ok.config_version(), 7U);
  EXPECT_EQ(ok.sent_at().seconds(), 1'800'000'000);

  const ServiceStatus degraded = propagator::make_status("pod-1", "consumer missing", 0, now);
  EXPECT_EQ(degraded.state(), ServiceStatus::STATE_DEGRADED);
  EXPECT_EQ(degraded.detail(), "consumer missing");
}

}  // namespace
