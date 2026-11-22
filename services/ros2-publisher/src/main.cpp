#include <memory>
#include <rclcpp/rclcpp.hpp>

#include "ros2_publisher/network_config.hpp"
#include "ros2_publisher/publisher_node.hpp"

int main(int argc, char** argv) {
  rclcpp::init(argc, argv);
  auto node = std::make_shared<ros2_publisher::PublisherNode>(
      ros2_publisher::read_network_config(ros2_publisher::process_env));
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}
