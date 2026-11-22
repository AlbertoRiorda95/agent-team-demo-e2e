// Public interface of the propagator library (foundations skeleton).
//
// No physics yet: the entry point connects to NATS and waits until it is told
// to stop. The trajectory propagation comes with the M1 contracts.
#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <initializer_list>
#include <memory>
#include <ostream>
#include <string>
#include <string_view>
#include <utility>

namespace propagator {

/// Version of the propagator library.
[[nodiscard]] std::string_view version() noexcept;

/// Health of the service: `ok` when connected to NATS, `degraded` otherwise.
enum class Health : std::uint8_t { ok, degraded };

/// "ok" or "degraded".
[[nodiscard]] std::string_view to_string(Health health) noexcept;

/// Configuration read from the environment.
struct Config {
  /// NATS server URL (`NATS_URL`).
  std::string nats_url;
};

/// URL used when `NATS_URL` is not set (the local dev stack, `.env.example`).
inline constexpr std::string_view default_nats_url = "nats://localhost:4222";

/// Reads the configuration from the environment (`NATS_URL`).
[[nodiscard]] Config config_from_env();

/// `url` without its credentials (`nats://user:pass@host` -> `nats://***@host`),
/// safe to log.
[[nodiscard]] std::string redact_url(std::string_view url);

/// Capped exponential backoff between connection attempts.
struct BackoffPolicy {
  std::chrono::milliseconds initial{500};
  std::chrono::milliseconds max{30'000};
};

/// Delay before retry number `attempt` (0 for the first retry):
/// `initial * 2^attempt`, never more than `max`.
[[nodiscard]] std::chrono::milliseconds backoff_delay(const BackoffPolicy& policy,
                                                      unsigned attempt) noexcept;

/// One key/value field of a structured log line.
using LogField = std::pair<std::string_view, std::string_view>;

/// Writes one JSON log line: {"level":...,"service":"propagator","msg":...,<fields>}.
void log_json(std::ostream& out, std::string_view level, std::string_view message,
              std::initializer_list<LogField> fields = {});

/// A connection to NATS that never throws on a failed connection: it reports
/// `degraded` instead, and once connected it reconnects on its own.
class NatsConnection {
 public:
  NatsConnection();
  ~NatsConnection();
  NatsConnection(const NatsConnection&) = delete;
  NatsConnection& operator=(const NatsConnection&) = delete;
  NatsConnection(NatsConnection&&) = delete;
  NatsConnection& operator=(NatsConnection&&) = delete;

  /// One connection attempt to `url`. Returns true when connected; on failure
  /// writes `error` (when not null) and stays degraded.
  bool connect(const std::string& url, std::string* error = nullptr);

  /// Current health, updated by the client's disconnect/reconnect callbacks.
  [[nodiscard]] Health health() const noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

/// Stub entry point: connects to NATS (retrying with `backoff` and logging a
/// JSON error on each failure) and then waits until `stop` becomes true.
/// Returns the process exit code.
int run(const Config& config, const std::atomic<bool>& stop, std::ostream& log,
        const BackoffPolicy& backoff = {});

}  // namespace propagator
