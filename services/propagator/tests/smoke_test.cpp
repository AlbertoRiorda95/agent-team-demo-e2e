// Smoke tests of the propagator library through its public header
// (docs/design/foundations.md > Test seams): they catch the toolchain, not NATS.
#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <sstream>
#include <string>
#include <thread>

#include "propagator/propagator.hpp"

namespace {

// Nothing listens on port 1: the connection is refused at once.
constexpr const char* unreachable_url = "nats://127.0.0.1:1";

using std::chrono::milliseconds;

TEST(Propagator, HasAVersion) { EXPECT_EQ(propagator::version(), "0.0.0"); }

TEST(Propagator, HealthNames) {
  EXPECT_EQ(propagator::to_string(propagator::Health::ok), "ok");
  EXPECT_EQ(propagator::to_string(propagator::Health::degraded), "degraded");
}

TEST(Propagator, ReadsNatsUrlFromTheEnvironment) {
  ASSERT_EQ(setenv("NATS_URL", "nats://nats:4222", 1), 0);
  EXPECT_EQ(propagator::config_from_env().nats_url, "nats://nats:4222");
  ASSERT_EQ(unsetenv("NATS_URL"), 0);
  EXPECT_EQ(propagator::config_from_env().nats_url, propagator::default_nats_url);
}

TEST(Propagator, RedactsCredentialsFromUrls) {
  EXPECT_EQ(propagator::redact_url("nats://user:secret@nats:4222"), "nats://***@nats:4222");
  EXPECT_EQ(propagator::redact_url("nats://token@nats:4222/x@y"), "nats://***@nats:4222/x@y");
  EXPECT_EQ(propagator::redact_url("nats://nats:4222"), "nats://nats:4222");
  EXPECT_EQ(propagator::redact_url("nats://nats:4222/a@b"), "nats://nats:4222/a@b");
}

TEST(Propagator, RunNeverLogsCredentials) {
  std::atomic<bool> stop{true};
  std::ostringstream log;
  EXPECT_EQ(propagator::run(propagator::Config{"nats://user:secret@127.0.0.1:1"}, stop, log),
            EXIT_SUCCESS);
  EXPECT_EQ(log.str().find("secret"), std::string::npos);
  EXPECT_NE(log.str().find("nats://***@127.0.0.1:1"), std::string::npos);
}

TEST(Propagator, BackoffDoublesUpToTheCap) {
  const propagator::BackoffPolicy policy{milliseconds{100}, milliseconds{1'000}};
  EXPECT_EQ(propagator::backoff_delay(policy, 0), milliseconds{100});
  EXPECT_EQ(propagator::backoff_delay(policy, 1), milliseconds{200});
  EXPECT_EQ(propagator::backoff_delay(policy, 3), milliseconds{800});
  EXPECT_EQ(propagator::backoff_delay(policy, 4), milliseconds{1'000});
  EXPECT_EQ(propagator::backoff_delay(policy, 1'000), milliseconds{1'000});
}

TEST(Propagator, LogsOneEscapedJsonLine) {
  std::ostringstream out;
  propagator::log_json(out, "error", "say \"hi\"\n", {{"key", "a\\b"}});
  EXPECT_EQ(out.str(),
            "{\"level\":\"error\",\"service\":\"propagator\",\"msg\":\"say \\\"hi\\\"\\n\","
            "\"key\":\"a\\\\b\"}\n");
}

TEST(Propagator, UnreachableNatsIsDegradedNotAnError) {
  propagator::NatsConnection nats;
  std::string error;
  EXPECT_FALSE(nats.connect(unreachable_url, &error));
  EXPECT_FALSE(error.empty());
  EXPECT_EQ(nats.health(), propagator::Health::degraded);
}

TEST(Propagator, RunRetriesAndStopsCleanly) {
  std::atomic<bool> stop{false};
  std::ostringstream log;
  int code = -1;
  std::thread runner([&] {
    code = propagator::run(propagator::Config{unreachable_url}, stop, log,
                           propagator::BackoffPolicy{milliseconds{10}, milliseconds{20}});
  });
  std::this_thread::sleep_for(milliseconds{200});
  stop.store(true);
  runner.join();

  EXPECT_EQ(code, EXIT_SUCCESS);
  const std::string text = log.str();
  EXPECT_NE(text.find("\"msg\":\"cannot connect to NATS\""), std::string::npos);
  EXPECT_NE(text.find("\"health\":\"degraded\""), std::string::npos);
  EXPECT_NE(text.find("\"msg\":\"stopping\""), std::string::npos);
}

}  // namespace
