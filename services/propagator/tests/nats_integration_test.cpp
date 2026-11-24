// Integration tests of the propagator pipeline against a real NATS with
// JetStream and the streams of proto/nats/streams/ applied
// (docs/design/propagation.md > Test seams, "Integration"). The server comes
// from `NATS_TEST_URL` (the CI `propagator` job runs ci/nats-test.sh; locally
// `ci/nats-test.sh up`); without it the tests are skipped.
//
// Each test runs `propagator::run` in a thread, like the process does, and
// talks to it only through NATS.
#include <gtest/gtest.h>
#include <nats/nats.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "propagator/config.hpp"
#include "propagator/propagator.hpp"
#include "trajectory/v1/config.pb.h"
#include "trajectory/v1/launch.pb.h"
#include "trajectory/v1/service.pb.h"
#include "trajectory/v1/trajectory.pb.h"

namespace {

namespace fs = std::filesystem;
using std::chrono::milliseconds;
using std::chrono::steady_clock;
using trajectory::v1::ConfigApplied;
using trajectory::v1::ConfigSet;
using trajectory::v1::LaunchAccepted;
using trajectory::v1::PipelineError;
using trajectory::v1::ServiceStatus;
using trajectory::v1::TrajectoryComputed;

std::string test_url() {
  // NOLINTNEXTLINE(concurrency-mt-unsafe): read before any thread starts
  const char* url = std::getenv("NATS_TEST_URL");
  return url == nullptr ? std::string{} : std::string{url};
}

std::string random_id() {
  std::random_device device;
  std::mt19937_64 random(device());
  std::uniform_int_distribution<std::uint64_t> any;
  std::ostringstream id;
  id << std::hex << any(random) << any(random);
  return id.str();
}

std::string random_launch_id() { return "it-" + random_id(); }

// A fresh folder for the config file of one test, removed at the end.
class TempFolder {
 public:
  TempFolder() : path_(fs::temp_directory_path() / ("propagator-it-" + random_id())) {
    fs::create_directories(path_);
  }
  ~TempFolder() {
    std::error_code ignored;
    fs::remove_all(path_, ignored);
  }
  TempFolder(const TempFolder&) = delete;
  TempFolder& operator=(const TempFolder&) = delete;
  TempFolder(TempFolder&&) = delete;
  TempFolder& operator=(TempFolder&&) = delete;
  [[nodiscard]] fs::path file() const { return path_ / "config.json"; }

 private:
  fs::path path_;
};

struct ConnectionDeleter {
  void operator()(natsConnection* c) const { natsConnection_Destroy(c); }
};
struct ContextDeleter {
  void operator()(jsCtx* js) const { jsCtx_Destroy(js); }
};
struct SubscriptionDeleter {
  void operator()(natsSubscription* s) const { natsSubscription_Destroy(s); }
};
struct MessageDeleter {
  void operator()(natsMsg* m) const { natsMsg_Destroy(m); }
};
using Subscription = std::unique_ptr<natsSubscription, SubscriptionDeleter>;
using Message = std::unique_ptr<natsMsg, MessageDeleter>;

std::string payload_of(natsMsg* message) {
  return {natsMsg_GetData(message),
          static_cast<std::string::size_type>(std::max(0, natsMsg_GetDataLength(message)))};
}

// The service under test, running in its own thread until destroyed.
class RunningService {
 public:
  RunningService(const std::string& url, const fs::path& config_path)
      : thread_([this, url, config_path] {
          code_ = propagator::run(propagator::Config{url, config_path.string()}, stop_, log_);
        }) {}
  ~RunningService() { stop(); }
  RunningService(const RunningService&) = delete;
  RunningService& operator=(const RunningService&) = delete;
  RunningService(RunningService&&) = delete;
  RunningService& operator=(RunningService&&) = delete;

  // Stops the service and returns its log.
  std::string stop() {
    stop_.store(true);
    if (thread_.joinable()) {
      thread_.join();
    }
    return log_.str();
  }
  [[nodiscard]] int code() const { return code_; }

 private:
  std::atomic<bool> stop_{false};
  std::ostringstream log_;
  int code_ = -1;
  std::thread thread_;
};

class PropagatorOnNats : public ::testing::Test {
 protected:
  void SetUp() override {
    url_ = test_url();
    if (url_.empty()) {
      GTEST_SKIP() << "NATS_TEST_URL is not set (ci/nats-test.sh up)";
    }
    natsConnection* connection = nullptr;
    ASSERT_EQ(natsConnection_ConnectTo(&connection, url_.c_str()), NATS_OK) << url_;
    connection_.reset(connection);
    jsCtx* js = nullptr;
    ASSERT_EQ(natsConnection_JetStream(&js, connection_.get(), nullptr), NATS_OK);
    js_.reset(js);
  }

  Subscription subscribe(const char* subject) {
    natsSubscription* subscription = nullptr;
    EXPECT_EQ(natsConnection_SubscribeSync(&subscription, connection_.get(), subject), NATS_OK);
    EXPECT_EQ(natsConnection_Flush(connection_.get()), NATS_OK);
    return Subscription{subscription};
  }

  // Publishes `launch` on launches.accepted as api does; returns its stream sequence.
  std::uint64_t publish_launch(const LaunchAccepted& launch) {
    const std::string bytes = launch.SerializeAsString();
    jsPubOptions options;
    jsPubOptions_Init(&options);
    options.MsgId = launch.launch_id().c_str();
    jsPubAck* ack = nullptr;
    EXPECT_EQ(js_Publish(&ack, js_.get(), "launches.accepted", bytes.data(),
                         static_cast<int>(bytes.size()), &options, nullptr),
              NATS_OK);
    const std::uint64_t sequence = ack == nullptr ? 0 : ack->Sequence;
    jsPubAck_Destroy(ack);
    return sequence;
  }

  // The first message on `subscription` for which `matches` is true, waiting
  // up to `timeout`.
  template <typename Matches>
  Message next_matching(natsSubscription* subscription, milliseconds timeout, Matches matches) {
    const auto deadline = steady_clock::now() + timeout;
    while (steady_clock::now() < deadline) {
      natsMsg* raw = nullptr;
      const auto left =
          std::chrono::duration_cast<milliseconds>(deadline - steady_clock::now()).count();
      if (natsSubscription_NextMsg(&raw, subscription, std::max<std::int64_t>(left, 1)) !=
          NATS_OK) {
        continue;
      }
      Message message{raw};
      if (matches(message.get())) {
        return message;
      }
    }
    return nullptr;
  }

  // True once the consumer `propagator` has acked (or terminated) every
  // message up to stream sequence `sequence`, within `timeout`.
  bool acked_up_to(std::uint64_t sequence, milliseconds timeout) {
    const auto deadline = steady_clock::now() + timeout;
    while (steady_clock::now() < deadline) {
      jsConsumerInfo* info = nullptr;
      if (js_GetConsumerInfo(&info, js_.get(), "LAUNCHES", "propagator", nullptr, nullptr) ==
          NATS_OK) {
        const bool done = info->AckFloor.Stream >= sequence && info->NumAckPending == 0;
        jsConsumerInfo_Destroy(info);
        if (done) {
          return true;
        }
      }
      std::this_thread::sleep_for(milliseconds{100});
    }
    return false;
  }

  static LaunchAccepted launch(const std::string& id) {
    LaunchAccepted l;
    l.set_launch_id(id);
    l.mutable_accepted_at()->set_seconds(1'800'000'000);
    auto* r = l.mutable_request();
    r->set_mass_kg(2.0);
    r->mutable_position()->set_z_m(1.5);
    r->set_azimuth_deg(45.0);
    r->set_elevation_deg(70.0);
    r->set_force_n(80.0);
    r->set_burn_duration_s(1.5);
    auto* c = l.mutable_config();
    c->set_propagation_time_s(60.0);
    c->set_sample_step_s(0.01);
    c->set_gravity_mps2(9.80665);
    c->set_config_version(3);
    return l;
  }

  // Publishes `set` on config.propagator.set as control-web does.
  void publish_config(const ConfigSet& set) {
    const std::string bytes = set.SerializeAsString();
    ASSERT_EQ(natsConnection_Publish(connection_.get(), "config.propagator.set", bytes.data(),
                                     static_cast<int>(bytes.size())),
              NATS_OK);
    ASSERT_EQ(natsConnection_Flush(connection_.get()), NATS_OK);
  }

  static ConfigSet config_set(std::uint64_t version, double propagation_time_s,
                              double sample_step_s) {
    ConfigSet set;
    set.set_service("propagator");
    set.set_config_version(version);
    set.mutable_propagator()->set_propagation_time_s(propagation_time_s);
    set.mutable_propagator()->set_sample_step_s(sample_step_s);
    return set;
  }

  // The next ConfigApplied of this host on `subscription` within `timeout`,
  // or nothing.
  std::optional<ConfigApplied> next_applied(natsSubscription* subscription, milliseconds timeout) {
    const std::string instance = propagator::instance_name();
    ConfigApplied applied;
    const Message message = next_matching(subscription, timeout, [&](natsMsg* m) {
      return applied.ParseFromString(payload_of(m)) && applied.instance() == instance;
    });
    if (message == nullptr) {
      return std::nullopt;
    }
    return applied;
  }

  // The next heartbeat of this host on `subscription` within `timeout`.
  std::optional<ServiceStatus> next_heartbeat(natsSubscription* subscription,
                                              milliseconds timeout) {
    const std::string instance = propagator::instance_name();
    ServiceStatus heartbeat;
    const Message message = next_matching(subscription, timeout, [&](natsMsg* m) {
      return heartbeat.ParseFromString(payload_of(m)) && heartbeat.instance() == instance;
    });
    if (message == nullptr) {
      return std::nullopt;
    }
    return heartbeat;
  }

  TempFolder folder_;
  std::string url_;
  std::unique_ptr<natsConnection, ConnectionDeleter> connection_;
  std::unique_ptr<jsCtx, ContextDeleter> js_;
};

TEST_F(PropagatorOnNats, ALaunchBecomesOneTrajectoryAndIsAcked) {
  const std::string id = random_launch_id();
  const Subscription trajectories = subscribe("trajectories.computed");
  RunningService service(url_, folder_.file());

  const LaunchAccepted input = launch(id);
  const std::uint64_t sequence = publish_launch(input);
  ASSERT_GT(sequence, 0U);

  TrajectoryComputed trajectory;
  const Message message = next_matching(trajectories.get(), milliseconds{10'000}, [&](natsMsg* m) {
    return trajectory.ParseFromString(payload_of(m)) && trajectory.launch_id() == id;
  });
  ASSERT_NE(message, nullptr) << service.stop();
  const char* msg_id = nullptr;
  ASSERT_EQ(natsMsgHeader_Get(message.get(), "Nats-Msg-Id", &msg_id), NATS_OK);
  EXPECT_STREQ(msg_id, id.c_str());
  EXPECT_EQ(trajectory.request().SerializeAsString(), input.request().SerializeAsString());
  EXPECT_EQ(trajectory.config().SerializeAsString(), input.config().SerializeAsString());
  EXPECT_EQ(trajectory.accepted_at().seconds(), input.accepted_at().seconds());
  EXPECT_EQ(trajectory.end_reason(), TrajectoryComputed::END_REASON_GROUND);
  EXPECT_GT(trajectory.samples_size(), 1);

  EXPECT_TRUE(acked_up_to(sequence, milliseconds{5'000})) << "the input was not acked";
  // Only one trajectory for this launch.
  EXPECT_EQ(next_matching(trajectories.get(), milliseconds{1'000},
                          [&](natsMsg* m) {
                            TrajectoryComputed again;
                            return again.ParseFromString(payload_of(m)) && again.launch_id() == id;
                          }),
            nullptr);

  const std::string log = service.stop();
  EXPECT_EQ(service.code(), EXIT_SUCCESS);
  EXPECT_NE(log.find("\"launch_id\":\"" + id + "\",\"outcome\":\"computed\""), std::string::npos)
      << log;
}

TEST_F(PropagatorOnNats, AnInvalidLaunchIsAPipelineErrorAndIsNotRedelivered) {
  const std::string id = random_launch_id();
  const Subscription trajectories = subscribe("trajectories.computed");
  const Subscription errors = subscribe("pipeline.errors");
  RunningService service(url_, folder_.file());

  LaunchAccepted input = launch(id);
  input.mutable_request()->set_mass_kg(0.0);
  const std::uint64_t sequence = publish_launch(input);
  ASSERT_GT(sequence, 0U);

  PipelineError error;
  const Message message = next_matching(errors.get(), milliseconds{10'000}, [&](natsMsg* m) {
    return error.ParseFromString(payload_of(m)) && error.launch_id() == id;
  });
  ASSERT_NE(message, nullptr) << service.stop();
  EXPECT_EQ(error.service(), "propagator");
  EXPECT_EQ(error.subject(), "launches.accepted");
  EXPECT_EQ(error.message(), "request.mass_kg must be > 0");
  EXPECT_GT(error.occurred_at().seconds(), 0);

  // Terminated: off the pending list at once, not after the 30 s ack wait.
  EXPECT_TRUE(acked_up_to(sequence, milliseconds{5'000})) << "the input was not terminated";
  EXPECT_EQ(next_matching(trajectories.get(), milliseconds{1'000},
                          [&](natsMsg* m) {
                            TrajectoryComputed t;
                            return t.ParseFromString(payload_of(m)) && t.launch_id() == id;
                          }),
            nullptr);
  EXPECT_EQ(next_matching(errors.get(), milliseconds{1'000},
                          [&](natsMsg* m) {
                            PipelineError again;
                            return again.ParseFromString(payload_of(m)) && again.launch_id() == id;
                          }),
            nullptr)
      << "the invalid launch was redelivered";
}

TEST_F(PropagatorOnNats, AnUndecodableMessageIsAPipelineError) {
  const Subscription errors = subscribe("pipeline.errors");
  RunningService service(url_, folder_.file());

  const std::string garbage = "\xff\xff\xff not a LaunchAccepted";
  jsPubAck* ack = nullptr;
  ASSERT_EQ(js_Publish(&ack, js_.get(), "launches.accepted", garbage.data(),
                       static_cast<int>(garbage.size()), nullptr, nullptr),
            NATS_OK);
  const std::uint64_t sequence = ack->Sequence;
  jsPubAck_Destroy(ack);

  PipelineError error;
  const Message message = next_matching(errors.get(), milliseconds{10'000}, [&](natsMsg* m) {
    return error.ParseFromString(payload_of(m)) && error.launch_id().empty() &&
           error.service() == "propagator";
  });
  ASSERT_NE(message, nullptr) << service.stop();
  EXPECT_EQ(error.message(), "the message is not a trajectory.v1.LaunchAccepted");
  EXPECT_TRUE(acked_up_to(sequence, milliseconds{5'000}));
}

TEST_F(PropagatorOnNats, SendsAHeartbeatEveryFiveSeconds) {
  const Subscription status = subscribe("status.propagator");
  RunningService service(url_, folder_.file());
  const std::string instance = propagator::instance_name();

  std::vector<steady_clock::time_point> received;
  while (received.size() < 3) {
    ServiceStatus heartbeat;
    const Message message = next_matching(status.get(), milliseconds{8'000}, [&](natsMsg* m) {
      return heartbeat.ParseFromString(payload_of(m)) && heartbeat.instance() == instance;
    });
    ASSERT_NE(message, nullptr) << "no heartbeat\n" << service.stop();
    received.push_back(steady_clock::now());
    EXPECT_EQ(heartbeat.service(), "propagator");
    EXPECT_EQ(heartbeat.state(), ServiceStatus::STATE_OK) << heartbeat.detail();
    EXPECT_EQ(heartbeat.version(), propagator::version());
    EXPECT_EQ(heartbeat.config_version(), 0U);
    EXPECT_GT(heartbeat.sent_at().seconds(), 0);
  }
  for (std::size_t i = 1; i < received.size(); ++i) {
    const auto gap = std::chrono::duration_cast<milliseconds>(received[i] - received[i - 1]);
    EXPECT_GE(gap.count(), 4'000);  // 5 s +- 1 s
    EXPECT_LE(gap.count(), 6'000);
  }
}

TEST_F(PropagatorOnNats, StartsWithTheDefaultsAndPublishesThemAsApplied) {
  const Subscription applied = subscribe("config.propagator.applied");
  RunningService service(url_, folder_.file());

  const auto startup = next_applied(applied.get(), milliseconds{10'000});
  ASSERT_TRUE(startup.has_value()) << service.stop();
  EXPECT_EQ(startup->service(), "propagator");
  EXPECT_TRUE(startup->ok());
  EXPECT_EQ(startup->error(), "");
  EXPECT_EQ(startup->config_version(), 0U);
  EXPECT_EQ(startup->propagator().propagation_time_s(), 60.0);
  EXPECT_EQ(startup->propagator().sample_step_s(), 0.01);
  EXPECT_GT(startup->applied_at().seconds(), 0);
  EXPECT_FALSE(fs::exists(folder_.file())) << "the defaults are not written";
}

TEST_F(PropagatorOnNats, AValidConfigIsAppliedSavedAndInForceAfterARestart) {
  const Subscription applied = subscribe("config.propagator.applied");
  const Subscription status = subscribe("status.propagator");
  {
    RunningService service(url_, folder_.file());
    ASSERT_TRUE(next_applied(applied.get(), milliseconds{10'000}).has_value()) << service.stop();

    publish_config(config_set(7, 120.0, 0.02));
    const auto answer = next_applied(applied.get(), milliseconds{5'000});
    ASSERT_TRUE(answer.has_value()) << service.stop();
    EXPECT_TRUE(answer->ok()) << answer->error();
    EXPECT_EQ(answer->config_version(), 7U);
    EXPECT_EQ(answer->propagator().propagation_time_s(), 120.0);
    EXPECT_EQ(answer->propagator().sample_step_s(), 0.02);

    const auto saved = propagator::load_config_file(folder_.file());
    EXPECT_EQ(saved.problem, "");
    EXPECT_EQ(saved.config, (propagator::ConfigInForce{7, 120.0, 0.02}));

    // The same version again: acknowledged, nothing changes.
    publish_config(config_set(7, 30.0, 0.5));
    const auto again = next_applied(applied.get(), milliseconds{5'000});
    ASSERT_TRUE(again.has_value()) << service.stop();
    EXPECT_TRUE(again->ok());
    EXPECT_EQ(again->config_version(), 7U);
    EXPECT_EQ(again->propagator().propagation_time_s(), 120.0);

    const std::string log = service.stop();
    EXPECT_NE(log.find(R"("msg":"config set","version":"7","ok":"true","outcome":"applied")"),
              std::string::npos)
        << log;
  }

  // Restart: the file is the config in force, announced and on the heartbeat.
  // Drop the heartbeats of the first run still queued.
  next_matching(status.get(), milliseconds{300}, [](natsMsg* /*m*/) { return false; });
  RunningService restarted(url_, folder_.file());
  const auto startup = next_applied(applied.get(), milliseconds{10'000});
  ASSERT_TRUE(startup.has_value()) << restarted.stop();
  EXPECT_TRUE(startup->ok());
  EXPECT_EQ(startup->config_version(), 7U);
  EXPECT_EQ(startup->propagator().propagation_time_s(), 120.0);
  EXPECT_EQ(startup->propagator().sample_step_s(), 0.02);

  const auto heartbeat = next_heartbeat(status.get(), milliseconds{8'000});
  ASSERT_TRUE(heartbeat.has_value()) << restarted.stop();
  EXPECT_EQ(heartbeat->config_version(), 7U);
  EXPECT_EQ(heartbeat->state(), ServiceStatus::STATE_OK) << heartbeat->detail();
}

TEST_F(PropagatorOnNats, AnInvalidOrStaleConfigIsRefusedAndTheConfigInForceKept) {
  ASSERT_EQ(propagator::save_config_file(folder_.file(), {4, 90.0, 0.05}), std::nullopt);
  const Subscription applied = subscribe("config.propagator.applied");
  RunningService service(url_, folder_.file());
  const auto startup = next_applied(applied.get(), milliseconds{10'000});
  ASSERT_TRUE(startup.has_value()) << service.stop();
  EXPECT_EQ(startup->config_version(), 4U);

  publish_config(config_set(5, 3600.0, 0.001));  // over the sample cap
  const auto invalid = next_applied(applied.get(), milliseconds{5'000});
  ASSERT_TRUE(invalid.has_value()) << service.stop();
  EXPECT_FALSE(invalid->ok());
  EXPECT_EQ(invalid->error(), "propagation_time_s / sample_step_s must be <= 100000");
  EXPECT_EQ(invalid->config_version(), 4U);
  EXPECT_EQ(invalid->propagator().propagation_time_s(), 90.0);
  EXPECT_EQ(invalid->propagator().sample_step_s(), 0.05);

  publish_config(config_set(3, 60.0, 0.01));
  const auto stale = next_applied(applied.get(), milliseconds{5'000});
  ASSERT_TRUE(stale.has_value()) << service.stop();
  EXPECT_FALSE(stale->ok());
  EXPECT_EQ(stale->error(), "stale version");
  EXPECT_EQ(stale->config_version(), 4U);

  EXPECT_EQ(propagator::load_config_file(folder_.file()).config,
            (propagator::ConfigInForce{4, 90.0, 0.05}));
}

TEST_F(PropagatorOnNats, ACorruptConfigFileStartsWithTheDefaultsDegradedUntilAValidSet) {
  {
    std::ofstream out(folder_.file());
    out << "{ not json";
  }
  const Subscription applied = subscribe("config.propagator.applied");
  const Subscription status = subscribe("status.propagator");
  RunningService service(url_, folder_.file());

  const auto startup = next_applied(applied.get(), milliseconds{10'000});
  ASSERT_TRUE(startup.has_value()) << service.stop();
  EXPECT_TRUE(startup->ok());
  EXPECT_EQ(startup->config_version(), 0U);
  const auto degraded = next_heartbeat(status.get(), milliseconds{8'000});
  ASSERT_TRUE(degraded.has_value()) << service.stop();
  EXPECT_EQ(degraded->state(), ServiceStatus::STATE_DEGRADED);
  EXPECT_NE(degraded->detail().find("is not a JSON object"), std::string::npos)
      << degraded->detail();

  publish_config(config_set(1, 60.0, 0.1));
  const auto answer = next_applied(applied.get(), milliseconds{5'000});
  ASSERT_TRUE(answer.has_value()) << service.stop();
  EXPECT_TRUE(answer->ok());
  // The heartbeats sent before the set still say degraded; the next one is ok.
  std::optional<ServiceStatus> ok;
  const auto deadline = steady_clock::now() + milliseconds{12'000};
  while (steady_clock::now() < deadline) {
    ok = next_heartbeat(status.get(), milliseconds{6'000});
    if (ok.has_value() && ok->config_version() == 1U) {
      break;
    }
  }
  ASSERT_TRUE(ok.has_value()) << service.stop();
  EXPECT_EQ(ok->config_version(), 1U);
  EXPECT_EQ(ok->state(), ServiceStatus::STATE_OK) << ok->detail();
}

}  // namespace
