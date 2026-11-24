// The NATS adapter of the launch use case (pipeline.hpp): the durable pull
// consumer on `launches.accepted`, the JetStream publishes, the ack / nak /
// term of the input and the heartbeat. Internal to the service.
#pragma once

#include <nats/nats.h>

#include <chrono>
#include <cstdint>
#include <ostream>
#include <string>
#include <string_view>

#include "propagator/propagator.hpp"

namespace propagator {

class NatsPipeline {
 public:
  /// `connection` stays owned by the caller and must outlive this object.
  NatsPipeline(natsConnection* connection, std::ostream& log, std::string instance);
  ~NatsPipeline();
  NatsPipeline(const NatsPipeline&) = delete;
  NatsPipeline& operator=(const NatsPipeline&) = delete;
  NatsPipeline(NatsPipeline&&) = delete;
  NatsPipeline& operator=(NatsPipeline&&) = delete;

  /// Fetches at most one `LaunchAccepted`, waiting up to `wait`, and handles
  /// it. Creates the consumer and the subscription first when they are
  /// missing (retried on the next call when that fails).
  void poll(std::chrono::milliseconds wait);

  /// Publishes one `ServiceStatus` on `status.propagator` (core NATS):
  /// `degraded` when NATS is down, the consumer is missing, the last publish
  /// failed or `config_problem` is not empty.
  void heartbeat(Health connection, std::uint64_t config_version, std::string_view config_problem);

 private:
  bool ensure_subscription();
  void drop_subscription();
  void handle(natsMsg* message);

  natsConnection* connection_;
  std::ostream& log_;
  std::string instance_;
  jsCtx* js_ = nullptr;
  natsSubscription* subscription_ = nullptr;
  /// Why the consumer is unusable, empty when it works.
  std::string consumer_problem_;
  /// The last failed publish, empty once a publish succeeds again.
  std::string publish_problem_;
};

}  // namespace propagator
