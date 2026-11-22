#include "ros2_publisher/network_config.hpp"

#include <gtest/gtest.h>

#include <map>
#include <string>

namespace {

ros2_publisher::EnvLookup fake_env(std::map<std::string, std::string> values) {
  return [values = std::move(values)](std::string_view name) -> std::optional<std::string> {
    auto it = values.find(std::string(name));
    if (it == values.end()) {
      return std::nullopt;
    }
    return it->second;
  };
}

}  // namespace

TEST(NetworkConfig, NothingSetIsNotConfigured) {
  const auto config = ros2_publisher::read_network_config(fake_env({}));
  EXPECT_FALSE(config.configured());
  EXPECT_EQ(ros2_publisher::describe(config), "no ROS2 network configured");
}

TEST(NetworkConfig, EmptyValuesCountAsUnset) {
  const auto config =
      ros2_publisher::read_network_config(fake_env({{"ROS_DOMAIN_ID", ""}, {"ROS_STATIC_PEERS", ""}}));
  EXPECT_FALSE(config.configured());
  EXPECT_EQ(ros2_publisher::describe(config), "no ROS2 network configured");
}

TEST(NetworkConfig, DomainIdIsConfigured) {
  const auto config = ros2_publisher::read_network_config(fake_env({{"ROS_DOMAIN_ID", "7"}}));
  EXPECT_TRUE(config.configured());
  EXPECT_EQ(ros2_publisher::describe(config), "ROS2 network configured: ROS_DOMAIN_ID=7");
}

TEST(NetworkConfig, StaticPeersAreConfigured) {
  const auto config = ros2_publisher::read_network_config(fake_env({{"ROS_STATIC_PEERS", "10.0.0.2"}}));
  EXPECT_TRUE(config.configured());
  EXPECT_EQ(ros2_publisher::describe(config), "ROS2 network configured: ROS_STATIC_PEERS=10.0.0.2");
}
