// The config use case of the propagator (docs/design/propagation.md > User
// flows 2 and 3, Data and API), without NATS: validate a `ConfigSet` with the
// version rule, keep the config in force in its local JSON file (written
// atomically) and build the `ConfigApplied` answers. The NATS adapter
// (nats_pipeline.hpp) only moves bytes.
#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

#include "trajectory/v1/config.pb.h"

namespace propagator {

/// Subjects of proto/README.md > NATS subjects (both on the `CONFIG` stream).
inline constexpr std::string_view config_set_subject = "config.propagator.set";
inline constexpr std::string_view config_applied_subject = "config.propagator.applied";

/// Where the config in force is kept when `PROPAGATOR_CONFIG_PATH` is not set.
inline constexpr std::string_view default_config_path = "/var/lib/propagator/config.json";

/// The propagation config in force. The defaults are version 0 (reserved for
/// them, proto/trajectory/v1/config.proto).
struct ConfigInForce {
  std::uint64_t version = 0;
  double propagation_time_s = 60.0;
  double sample_step_s = 0.01;

  friend bool operator==(const ConfigInForce&, const ConfigInForce&) = default;
};

/// Why these values are not a valid propagation config, or nothing: finite
/// numbers, `propagation_time_s` in (0, 3600], `sample_step_s` in [0.001, 1],
/// `propagation_time_s / sample_step_s <= 100000`.
[[nodiscard]] std::optional<std::string> validate_config_values(double propagation_time_s,
                                                                double sample_step_s);

/// What a `ConfigSet` does to the config in force.
struct ConfigDecision {
  enum class Kind : std::uint8_t {
    apply,        ///< a higher version: save it, then put it in force
    acknowledge,  ///< the version in force: ok again, nothing changes
    reject,       ///< invalid or stale: ok = false, nothing changes
  };
  Kind kind = Kind::reject;
  /// The config to put in force (`apply`), else the config in force.
  ConfigInForce config;
  /// The version the set asked for (0 when it does not decode).
  std::uint64_t requested_version = 0;
  /// Why it is rejected, empty otherwise.
  std::string error;
};

/// Decodes `payload` (the binary Protobuf of a `ConfigSet`), validates it
/// (`service` = "propagator", the `propagator` payload set, the values above)
/// and applies the version rule against `in_force`: higher applied, equal
/// acknowledged again, lower rejected with "stale version". Never throws on bad
/// input: that is a `reject`.
[[nodiscard]] ConfigDecision decide_config_set(std::string_view payload,
                                               const ConfigInForce& in_force);

/// The answer on `config.propagator.applied`: the config in force in the
/// `propagator` member, `ok` and `error` as given, stamped with `now`.
[[nodiscard]] trajectory::v1::ConfigApplied make_config_applied(
    std::string_view instance, const ConfigInForce& in_force, bool ok, std::string_view error,
    std::chrono::system_clock::time_point now);

/// The config read from the local file at start-up.
struct LoadedConfig {
  ConfigInForce config;
  /// Why the file was not used (unreadable, corrupt, invalid values), empty
  /// when it was read or does not exist. With a problem `config` holds the
  /// defaults.
  std::string problem;
};

/// Reads the JSON file `{"config_version", "propagation_time_s",
/// "sample_step_s"}` at `path`. No file: the defaults, no problem. A file that
/// cannot be read, is not that JSON or holds invalid values: the defaults and
/// the problem.
[[nodiscard]] LoadedConfig load_config_file(const std::filesystem::path& path);

/// Writes `config` to `path` atomically: a temporary file in the same folder
/// (created when missing), flushed to disk, then renamed over `path`, so the
/// file is never half written. Returns why it failed, or nothing.
[[nodiscard]] std::optional<std::string> save_config_file(const std::filesystem::path& path,
                                                          const ConfigInForce& config);

}  // namespace propagator
