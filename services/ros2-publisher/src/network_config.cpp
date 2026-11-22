#include "ros2_publisher/network_config.hpp"

#include <cstdlib>

namespace ros2_publisher {

namespace {

std::optional<std::string> non_empty(const EnvLookup& env, std::string_view name) {
  auto value = env(name);
  if (!value || value->empty()) {
    return std::nullopt;
  }
  return value;
}

}  // namespace

std::optional<std::string> process_env(std::string_view name) {
  const std::string key(name);
  const char* value = std::getenv(key.c_str());  // NOLINT(concurrency-mt-unsafe): read at start-up only
  if (value == nullptr) {
    return std::nullopt;
  }
  return std::string(value);
}

bool NetworkConfig::configured() const { return domain_id.has_value() || static_peers.has_value(); }

NetworkConfig read_network_config(const EnvLookup& env) {
  return NetworkConfig{
      .domain_id = non_empty(env, "ROS_DOMAIN_ID"),
      .static_peers = non_empty(env, "ROS_STATIC_PEERS"),
  };
}

std::string describe(const NetworkConfig& config) {
  if (!config.configured()) {
    return "no ROS2 network configured";
  }
  std::string text = "ROS2 network configured:";
  if (config.domain_id) {
    text += " ROS_DOMAIN_ID=" + *config.domain_id;
  }
  if (config.static_peers) {
    text += " ROS_STATIC_PEERS=" + *config.static_peers;
  }
  return text;
}

}  // namespace ros2_publisher
