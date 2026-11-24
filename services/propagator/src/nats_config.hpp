// The NATS adapter of the config use case (config.hpp): the subscription to
// `config.propagator.set`, the `ConfigApplied` answers on
// `config.propagator.applied` (JetStream, the `CONFIG` stream) and the one of
// the config in force at start-up. Internal to the service.
#pragma once

#include <nats/nats.h>

#include <cstdint>
#include <filesystem>
#include <ostream>
#include <string>
#include <string_view>

#include "propagator/config.hpp"

namespace propagator {

class NatsConfig {
 public:
  /// `connection` stays owned by the caller and must outlive this object.
  /// `loaded` is what start-up read from `path`.
  NatsConfig(natsConnection* connection, std::ostream& log, std::string instance,
             std::filesystem::path path, const LoadedConfig& loaded);
  ~NatsConfig();
  NatsConfig(const NatsConfig&) = delete;
  NatsConfig& operator=(const NatsConfig&) = delete;
  NatsConfig(NatsConfig&&) = delete;
  NatsConfig& operator=(NatsConfig&&) = delete;

  /// Subscribes to `config.propagator.set` and publishes the start-up
  /// `ConfigApplied` when not done yet (retried on the next call when that
  /// fails), then handles every `ConfigSet` already received, without waiting.
  void poll();

  /// The version of the config in force.
  [[nodiscard]] std::uint64_t version() const noexcept { return in_force_.version; }

  /// Why the config is degraded (local file corrupt or unwritable, answer not
  /// published), empty when it is fine.
  [[nodiscard]] std::string problem() const;

 private:
  bool ensure_started();
  void handle(natsMsg* message);
  bool publish_applied(bool ok, std::string_view error);

  natsConnection* connection_;
  std::ostream& log_;
  std::string instance_;
  std::filesystem::path path_;
  ConfigInForce in_force_;
  jsCtx* js_ = nullptr;
  natsSubscription* subscription_ = nullptr;
  bool startup_published_ = false;
  /// The local file problem: corrupt at start-up, or the last save failed.
  std::string file_problem_;
  /// The last failed publish of a `ConfigApplied`, empty once one succeeds.
  std::string publish_problem_;
};

}  // namespace propagator
