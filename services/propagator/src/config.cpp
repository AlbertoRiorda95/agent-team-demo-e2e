#include "propagator/config.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <cerrno>
#include <cmath>
#include <cstring>
#include <exception>
#include <fstream>
#include <iterator>
#include <nlohmann/json.hpp>
#include <string>
#include <system_error>

#include "propagator/pipeline.hpp"
#include "propagator/propagate.hpp"
#include "stamp.hpp"

namespace propagator {

namespace {

using trajectory::v1::ConfigApplied;
using trajectory::v1::ConfigSet;

constexpr std::string_view service_name = "propagator";

// The keys of the local file (docs/design/propagation.md > Data and API).
constexpr const char* version_key = "config_version";
constexpr const char* propagation_time_key = "propagation_time_s";
constexpr const char* sample_step_key = "sample_step_s";

std::string errno_text(int error) {
  return std::error_code{error, std::generic_category()}.message();
}

ConfigDecision rejected(const ConfigInForce& in_force, std::uint64_t requested, std::string error) {
  return ConfigDecision{.kind = ConfigDecision::Kind::reject,
                        .config = in_force,
                        .requested_version = requested,
                        .error = std::move(error)};
}

LoadedConfig unusable(const std::filesystem::path& path, const std::string& why) {
  return LoadedConfig{.config = ConfigInForce{},
                      .problem = "config file " + path.string() + " " + why};
}

// Writes all of `bytes` to `fd`, retrying short writes and EINTR.
bool write_all(int fd, std::string_view bytes) {
  while (!bytes.empty()) {
    const ssize_t written = ::write(fd, bytes.data(), bytes.size());
    if (written < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    bytes.remove_prefix(static_cast<std::size_t>(written));
  }
  return true;
}

}  // namespace

std::optional<std::string> validate_config_values(double propagation_time_s, double sample_step_s) {
  if (!std::isfinite(propagation_time_s) || !std::isfinite(sample_step_s)) {
    return "a value is not a finite number";
  }
  if (propagation_time_s <= 0.0 || propagation_time_s > max_propagation_time_s) {
    return "propagation_time_s must be in (0, 3600]";
  }
  if (sample_step_s < min_sample_step_s || sample_step_s > max_sample_step_s) {
    return "sample_step_s must be in [0.001, 1]";
  }
  if (propagation_time_s / sample_step_s > max_steps) {
    return "propagation_time_s / sample_step_s must be <= 100000";
  }
  return std::nullopt;
}

ConfigDecision decide_config_set(std::string_view payload, const ConfigInForce& in_force) {
  ConfigSet set;
  if (!set.ParseFromArray(payload.data(), static_cast<int>(payload.size()))) {
    return rejected(in_force, 0, "the message is not a trajectory.v1.ConfigSet");
  }
  const std::uint64_t requested = set.config_version();
  if (set.service() != service_name) {
    return rejected(in_force, requested, "service must be \"propagator\"");
  }
  if (!set.has_propagator()) {
    return rejected(in_force, requested, "the propagator payload is missing");
  }
  const auto& values = set.propagator();
  if (auto reason = validate_config_values(values.propagation_time_s(), values.sample_step_s())) {
    return rejected(in_force, requested, std::move(*reason));
  }
  if (requested < in_force.version) {
    return rejected(in_force, requested, "stale version");
  }
  if (requested == in_force.version) {
    return ConfigDecision{.kind = ConfigDecision::Kind::acknowledge,
                          .config = in_force,
                          .requested_version = requested,
                          .error = {}};
  }
  return ConfigDecision{.kind = ConfigDecision::Kind::apply,
                        .config = ConfigInForce{.version = requested,
                                                .propagation_time_s = values.propagation_time_s(),
                                                .sample_step_s = values.sample_step_s()},
                        .requested_version = requested,
                        .error = {}};
}

ConfigApplied make_config_applied(std::string_view instance, const ConfigInForce& in_force, bool ok,
                                  std::string_view error,
                                  std::chrono::system_clock::time_point now) {
  ConfigApplied applied;
  applied.set_service(std::string{service_name});
  applied.set_instance(std::string{instance});
  applied.set_config_version(in_force.version);
  applied.set_ok(ok);
  applied.set_error(std::string{error});
  stamp(applied.mutable_applied_at(), now);
  applied.mutable_propagator()->set_propagation_time_s(in_force.propagation_time_s);
  applied.mutable_propagator()->set_sample_step_s(in_force.sample_step_s);
  return applied;
}

LoadedConfig load_config_file(const std::filesystem::path& path) {
  std::error_code error;
  if (!std::filesystem::exists(path, error)) {
    if (error) {
      return unusable(path, "cannot be read: " + error.message());
    }
    return LoadedConfig{};  // first start: the defaults
  }
  if (!std::filesystem::is_regular_file(path, error)) {
    return unusable(path, "is not a regular file");
  }
  std::string text;
  try {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
      return unusable(path, "cannot be read");
    }
    text.assign(std::istreambuf_iterator<char>{in}, std::istreambuf_iterator<char>{});
    if (in.bad()) {
      return unusable(path, "cannot be read");
    }
  } catch (const std::exception& read_error) {
    // libstdc++ throws from underflow on a read error (EISDIR, EIO...).
    return unusable(path, std::string{"cannot be read: "} + read_error.what());
  }

  // No exceptions: a corrupt file is an expected input here.
  const auto json = nlohmann::json::parse(text, nullptr, false);
  if (json.is_discarded() || !json.is_object()) {
    return unusable(path, "is not a JSON object");
  }
  const auto version = json.find(version_key);
  const auto propagation_time = json.find(propagation_time_key);
  const auto sample_step = json.find(sample_step_key);
  if (version == json.end() || !version->is_number_unsigned()) {
    return unusable(path, "has no unsigned integer config_version");
  }
  if (propagation_time == json.end() || !propagation_time->is_number() ||
      sample_step == json.end() || !sample_step->is_number()) {
    return unusable(path, "has no numbers propagation_time_s and sample_step_s");
  }
  const ConfigInForce config{.version = version->get<std::uint64_t>(),
                             .propagation_time_s = propagation_time->get<double>(),
                             .sample_step_s = sample_step->get<double>()};
  if (const auto reason = validate_config_values(config.propagation_time_s, config.sample_step_s)) {
    return unusable(path, "is invalid: " + *reason);
  }
  return LoadedConfig{.config = config, .problem = {}};
}

std::optional<std::string> save_config_file(const std::filesystem::path& path,
                                            const ConfigInForce& config) {
  const nlohmann::json json = {{version_key, config.version},
                               {propagation_time_key, config.propagation_time_s},
                               {sample_step_key, config.sample_step_s}};
  const std::string bytes = json.dump() + "\n";

  std::error_code error;
  const auto folder = path.parent_path();
  if (!folder.empty()) {
    std::filesystem::create_directories(folder, error);
    if (error) {
      return "cannot create " + folder.string() + ": " + error.message();
    }
  }
  // Same folder as the target, so the rename is atomic (same file system);
  // never through a symbolic link planted at the temporary name.
  auto temporary = path;
  temporary += ".tmp-" + std::to_string(::getpid());

  constexpr int flags = O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW;
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-vararg): POSIX open
  const int fd = ::open(temporary.c_str(), flags, 0644);
  if (fd < 0) {
    return "cannot write " + temporary.string() + ": " + errno_text(errno);
  }
  const bool written = write_all(fd, bytes) && ::fsync(fd) == 0;
  const int write_error = errno;
  const bool closed = ::close(fd) == 0;
  if (!written || !closed) {
    std::filesystem::remove(temporary, error);
    return "cannot write " + temporary.string() + ": " + errno_text(write_error);
  }
  std::filesystem::rename(temporary, path, error);
  if (error) {
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return "cannot rename " + temporary.string() + " to " + path.string() + ": " + error.message();
  }
  // Make the rename itself durable; a failure here leaves a valid file.
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-vararg): POSIX open
  const int folder_fd = ::open(folder.empty() ? "." : folder.c_str(), O_RDONLY | O_CLOEXEC);
  if (folder_fd >= 0) {
    ::fsync(folder_fd);
    ::close(folder_fd);
  }
  return std::nullopt;
}

}  // namespace propagator
