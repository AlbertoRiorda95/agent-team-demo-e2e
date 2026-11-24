// Unit tests of the config use case (propagator/config.hpp): the validation
// and the version rule of a ConfigSet, the ConfigApplied answer, and the local
// file load/save in a temporary folder (docs/design/propagation.md > Test
// seams, "Config module"). The NATS flow is in nats_integration_test.
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <limits>
#include <random>
#include <string>

#include "propagator/config.hpp"

namespace {

namespace fs = std::filesystem;
using propagator::ConfigDecision;
using propagator::ConfigInForce;
using trajectory::v1::ConfigSet;

const auto now = std::chrono::system_clock::time_point{std::chrono::seconds{1'800'000'000}} +
                 std::chrono::nanoseconds{500};

ConfigSet config_set(std::uint64_t version, double propagation_time_s, double sample_step_s) {
  ConfigSet set;
  set.set_service("propagator");
  set.set_config_version(version);
  set.mutable_propagator()->set_propagation_time_s(propagation_time_s);
  set.mutable_propagator()->set_sample_step_s(sample_step_s);
  return set;
}

ConfigDecision decide(const ConfigSet& set, const ConfigInForce& in_force) {
  return propagator::decide_config_set(set.SerializeAsString(), in_force);
}

const ConfigInForce in_force_v5{5, 30.0, 0.05};

// A fresh empty folder, removed at the end of the test.
class TempFolder {
 public:
  TempFolder() {
    std::random_device device;
    path_ = fs::temp_directory_path() / ("propagator-config-test-" + std::to_string(device()));
    fs::create_directories(path_);
  }
  ~TempFolder() {
    std::error_code ignored;
    fs::permissions(path_, fs::perms::owner_all, fs::perm_options::add, ignored);
    fs::remove_all(path_, ignored);
  }
  TempFolder(const TempFolder&) = delete;
  TempFolder& operator=(const TempFolder&) = delete;
  TempFolder(TempFolder&&) = delete;
  TempFolder& operator=(TempFolder&&) = delete;
  [[nodiscard]] const fs::path& path() const { return path_; }

 private:
  fs::path path_;
};

void write_file(const fs::path& path, const std::string& text) {
  std::ofstream out(path, std::ios::binary);
  out << text;
}

std::string read_file(const fs::path& path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>{in}, std::istreambuf_iterator<char>{}};
}

TEST(ConfigDefaults, AreVersionZeroSixtySecondsTenMilliseconds) {
  const ConfigInForce defaults;
  EXPECT_EQ(defaults.version, 0U);
  EXPECT_EQ(defaults.propagation_time_s, 60.0);
  EXPECT_EQ(defaults.sample_step_s, 0.01);
}

TEST(ValidateConfigValues, AcceptsTheBoundsOfTheRanges) {
  EXPECT_EQ(propagator::validate_config_values(3600.0, 1.0), std::nullopt);
  EXPECT_EQ(propagator::validate_config_values(100.0, 0.001), std::nullopt);  // the cap exactly
  EXPECT_EQ(propagator::validate_config_values(1e-6, 0.001), std::nullopt);
}

TEST(ValidateConfigValues, RejectsValuesOutOfRange) {
  const double inf = std::numeric_limits<double>::infinity();
  const double nan = std::numeric_limits<double>::quiet_NaN();
  EXPECT_EQ(propagator::validate_config_values(nan, 0.01), "a value is not a finite number");
  EXPECT_EQ(propagator::validate_config_values(60.0, inf), "a value is not a finite number");
  EXPECT_EQ(propagator::validate_config_values(0.0, 0.01),
            "propagation_time_s must be in (0, 3600]");
  EXPECT_EQ(propagator::validate_config_values(3600.5, 1.0),
            "propagation_time_s must be in (0, 3600]");
  EXPECT_EQ(propagator::validate_config_values(60.0, 0.0009),
            "sample_step_s must be in [0.001, 1]");
  EXPECT_EQ(propagator::validate_config_values(60.0, 1.5), "sample_step_s must be in [0.001, 1]");
  EXPECT_EQ(propagator::validate_config_values(100.5, 0.001),
            "propagation_time_s / sample_step_s must be <= 100000");
}

TEST(DecideConfigSet, AppliesAHigherVersion) {
  const auto decision = decide(config_set(6, 120.0, 0.02), in_force_v5);
  EXPECT_EQ(decision.kind, ConfigDecision::Kind::apply);
  EXPECT_EQ(decision.config, (ConfigInForce{6, 120.0, 0.02}));
  EXPECT_EQ(decision.requested_version, 6U);
  EXPECT_EQ(decision.error, "");
}

TEST(DecideConfigSet, AcknowledgesTheSameVersionWithoutChange) {
  // Even with other values: the version in force is the config in force.
  const auto decision = decide(config_set(5, 120.0, 0.02), in_force_v5);
  EXPECT_EQ(decision.kind, ConfigDecision::Kind::acknowledge);
  EXPECT_EQ(decision.config, in_force_v5);
  EXPECT_EQ(decision.error, "");
}

TEST(DecideConfigSet, RejectsALowerVersionAsStale) {
  const auto decision = decide(config_set(4, 120.0, 0.02), in_force_v5);
  EXPECT_EQ(decision.kind, ConfigDecision::Kind::reject);
  EXPECT_EQ(decision.config, in_force_v5);
  EXPECT_EQ(decision.requested_version, 4U);
  EXPECT_EQ(decision.error, "stale version");
}

TEST(DecideConfigSet, RejectsInvalidValuesWhateverTheVersion) {
  const auto decision = decide(config_set(9, 3600.0, 0.001), in_force_v5);
  EXPECT_EQ(decision.kind, ConfigDecision::Kind::reject);
  EXPECT_EQ(decision.config, in_force_v5);
  EXPECT_EQ(decision.error, "propagation_time_s / sample_step_s must be <= 100000");
}

TEST(DecideConfigSet, RejectsAnotherServiceOrAMissingPayload) {
  auto other = config_set(9, 60.0, 0.01);
  other.set_service("store");
  EXPECT_EQ(decide(other, in_force_v5).error, "service must be \"propagator\"");

  auto store_payload = config_set(9, 60.0, 0.01);
  store_payload.mutable_store()->set_table_prefix("demo_");  // replaces the oneof member
  EXPECT_EQ(decide(store_payload, in_force_v5).error, "the propagator payload is missing");
}

TEST(DecideConfigSet, RejectsBytesThatDoNotDecode) {
  const auto decision = propagator::decide_config_set("\xff\xff\xff garbage", in_force_v5);
  EXPECT_EQ(decision.kind, ConfigDecision::Kind::reject);
  EXPECT_EQ(decision.config, in_force_v5);
  EXPECT_EQ(decision.error, "the message is not a trajectory.v1.ConfigSet");
}

TEST(MakeConfigApplied, CarriesTheConfigInForce) {
  const auto applied =
      propagator::make_config_applied("pod-1", in_force_v5, false, "stale version", now);
  EXPECT_EQ(applied.service(), "propagator");
  EXPECT_EQ(applied.instance(), "pod-1");
  EXPECT_EQ(applied.config_version(), 5U);
  EXPECT_FALSE(applied.ok());
  EXPECT_EQ(applied.error(), "stale version");
  EXPECT_EQ(applied.applied_at().seconds(), 1'800'000'000);
  EXPECT_EQ(applied.applied_at().nanos(), 500);
  ASSERT_TRUE(applied.has_propagator());
  EXPECT_EQ(applied.propagator().propagation_time_s(), 30.0);
  EXPECT_EQ(applied.propagator().sample_step_s(), 0.05);
}

TEST(ConfigFile, MissingGivesTheDefaultsWithoutProblem) {
  const TempFolder folder;
  const auto loaded = propagator::load_config_file(folder.path() / "config.json");
  EXPECT_EQ(loaded.config, ConfigInForce{});
  EXPECT_EQ(loaded.problem, "");
}

TEST(ConfigFile, SaveThenLoadGivesTheSameConfig) {
  const TempFolder folder;
  const auto path = folder.path() / "nested" / "config.json";  // folder created on save
  const ConfigInForce config{42, 0.1 + 0.2, 1.0 / 3.0};        // round-trip of doubles
  ASSERT_EQ(propagator::save_config_file(path, config), std::nullopt);
  const auto loaded = propagator::load_config_file(path);
  EXPECT_EQ(loaded.problem, "");
  EXPECT_EQ(loaded.config, config);
}

TEST(ConfigFile, HoldsTheJsonOfTheSpecAndNoTemporaryFile) {
  const TempFolder folder;
  const auto path = folder.path() / "config.json";
  ASSERT_EQ(propagator::save_config_file(path, ConfigInForce{7, 120.0, 0.5}), std::nullopt);
  ASSERT_EQ(propagator::save_config_file(path, ConfigInForce{8, 90.0, 0.25}), std::nullopt);
  EXPECT_EQ(read_file(path),
            "{\"config_version\":8,\"propagation_time_s\":90.0,\"sample_step_s\":0.25}\n");
  int entries = 0;
  for ([[maybe_unused]] const auto& entry : fs::directory_iterator(folder.path())) {
    ++entries;
  }
  EXPECT_EQ(entries, 1) << "a temporary file was left behind";
}

TEST(ConfigFile, ASaveThatFailsLeavesThePreviousFile) {
  if (::geteuid() == 0) {
    GTEST_SKIP() << "root ignores the folder permissions";
  }
  const TempFolder folder;
  const auto path = folder.path() / "config.json";
  ASSERT_EQ(propagator::save_config_file(path, ConfigInForce{7, 120.0, 0.5}), std::nullopt);
  fs::permissions(folder.path(), fs::perms::owner_read | fs::perms::owner_exec);

  const auto error = propagator::save_config_file(path, ConfigInForce{8, 90.0, 0.25});
  ASSERT_TRUE(error.has_value());
  EXPECT_NE(error->find("cannot write"), std::string::npos) << *error;
  EXPECT_EQ(propagator::load_config_file(path).config, (ConfigInForce{7, 120.0, 0.5}));
}

TEST(ConfigFile, CorruptGivesTheDefaultsAndTheProblem) {
  const TempFolder folder;
  const auto path = folder.path() / "config.json";
  const std::pair<std::string, std::string> cases[] = {
      {"{\"config_version\": 3, \"propagation_ti", "is not a JSON object"},
      {"[1, 2, 3]", "is not a JSON object"},
      {"", "is not a JSON object"},
      {R"({"config_version": -1, "propagation_time_s": 60, "sample_step_s": 0.01})",
       "has no unsigned integer config_version"},
      {R"({"config_version": 1.5, "propagation_time_s": 60, "sample_step_s": 0.01})",
       "has no unsigned integer config_version"},
      {R"({"config_version": 3, "propagation_time_s": "60", "sample_step_s": 0.01})",
       "has no numbers propagation_time_s and sample_step_s"},
      {R"({"config_version": 3, "propagation_time_s": 60})",
       "has no numbers propagation_time_s and sample_step_s"},
      {R"({"config_version": 3, "propagation_time_s": 4000, "sample_step_s": 1})",
       "is invalid: propagation_time_s must be in (0, 3600]"},
  };
  for (const auto& [text, why] : cases) {
    write_file(path, text);
    const auto loaded = propagator::load_config_file(path);
    EXPECT_EQ(loaded.config, ConfigInForce{}) << text;
    EXPECT_EQ(loaded.problem, "config file " + path.string() + " " + why) << text;
  }
}

TEST(ConfigFile, AFolderInsteadOfAFileIsAProblem) {
  const TempFolder folder;
  const auto loaded = propagator::load_config_file(folder.path());
  EXPECT_EQ(loaded.config, ConfigInForce{});
  EXPECT_EQ(loaded.problem, "config file " + folder.path().string() + " is not a regular file");
}

}  // namespace
