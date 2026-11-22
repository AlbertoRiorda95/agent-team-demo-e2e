#include "ros2_publisher/publisher_node.hpp"

namespace ros2_publisher {

PublisherNode::PublisherNode(const NetworkConfig& network, const rclcpp::NodeOptions& options)
    : rclcpp::Node(kName, options), network_(network) {
  RCLCPP_INFO(get_logger(), "%s", describe(network_).c_str());
}

}  // namespace ros2_publisher
