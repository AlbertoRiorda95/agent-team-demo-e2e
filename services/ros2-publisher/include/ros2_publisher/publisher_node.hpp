#pragma once

#include <rclcpp/rclcpp.hpp>

#include "ros2_publisher/network_config.hpp"

namespace ros2_publisher {

/// The ros2-publisher node. Foundations skeleton: at start-up it logs its
/// ROS2 network configuration; it subscribes to NATS and publishes nothing yet.
class PublisherNode : public rclcpp::Node {
 public:
  static constexpr const char* kName = "ros2_publisher";

  explicit PublisherNode(const NetworkConfig& network,
                         const rclcpp::NodeOptions& options = rclcpp::NodeOptions());

  [[nodiscard]] const NetworkConfig& network() const { return network_; }

 private:
  NetworkConfig network_;
};

}  // namespace ros2_publisher
