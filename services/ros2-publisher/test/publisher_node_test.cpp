#include "ros2_publisher/publisher_node.hpp"

#include <gtest/gtest.h>

#include <memory>
#include <rclcpp/rclcpp.hpp>

// Smoke test: the node starts with no ROS2 network configured.
TEST(PublisherNode, StartsWithoutNetworkConfig) {
  rclcpp::init(0, nullptr);
  {
    auto node = std::make_shared<ros2_publisher::PublisherNode>(ros2_publisher::NetworkConfig{});
    EXPECT_STREQ(node->get_name(), ros2_publisher::PublisherNode::kName);
    EXPECT_FALSE(node->network().configured());

    rclcpp::executors::SingleThreadedExecutor executor;
    executor.add_node(node);
    executor.spin_some();
  }
  rclcpp::shutdown();
}
