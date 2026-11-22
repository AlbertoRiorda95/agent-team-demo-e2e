#pragma once

#include <functional>
#include <optional>
#include <string>
#include <string_view>

namespace ros2_publisher {

/// Reads one environment variable; returns std::nullopt when it is not set.
using EnvLookup = std::function<std::optional<std::string>(std::string_view name)>;

/// The process environment (std::getenv).
std::optional<std::string> process_env(std::string_view name);

/// The ROS2 network settings found in the environment.
struct NetworkConfig {
  std::optional<std::string> domain_id;     ///< ROS_DOMAIN_ID
  std::optional<std::string> static_peers;  ///< ROS_STATIC_PEERS

  /// True when at least one setting is present and not empty.
  [[nodiscard]] bool configured() const;
};

/// Reads ROS_DOMAIN_ID and ROS_STATIC_PEERS; an empty value counts as unset.
NetworkConfig read_network_config(const EnvLookup& env);

/// The start-up log line: "no ROS2 network configured", or the settings found.
std::string describe(const NetworkConfig& config);

}  // namespace ros2_publisher
