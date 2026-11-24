#include "propagator/propagator.hpp"

#include <nats/nats.h>

#include <unistd.h>

#include <algorithm>
#include <array>
#include <cstdlib>
#include <thread>

#include "nats_config.hpp"
#include "nats_pipeline.hpp"
#include "propagator/config.hpp"

namespace propagator {

namespace {

constexpr std::string_view service_name = "propagator";
constexpr std::int64_t connect_timeout_ms = 2'000;
constexpr std::chrono::milliseconds stop_poll{100};

void write_json_string(std::ostream& out, std::string_view text) {
  out << '"';
  for (const char c : text) {
    switch (c) {
      case '"':
        out << "\\\"";
        break;
      case '\\':
        out << "\\\\";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          constexpr std::string_view hex = "0123456789abcdef";
          const auto code = static_cast<unsigned char>(c);
          out << "\\u00" << hex.at(code >> 4U) << hex.at(code & 0x0FU);
        } else {
          out << c;
        }
    }
  }
  out << '"';
}

// Sleeps for `duration`, waking up early when `stop` becomes true.
void sleep_unless_stopped(std::chrono::milliseconds duration, const std::atomic<bool>& stop) {
  const auto deadline = std::chrono::steady_clock::now() + duration;
  while (!stop.load() && std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(std::min(stop_poll, duration));
  }
}

}  // namespace

std::string_view version() noexcept { return "0.0.0"; }

std::string_view to_string(Health health) noexcept {
  return health == Health::ok ? "ok" : "degraded";
}

Config config_from_env() {
  const auto variable = [](const char* name, std::string_view fallback) {
    // Read once at start-up, before any thread exists.
    // NOLINTNEXTLINE(concurrency-mt-unsafe)
    const char* value = std::getenv(name);
    return (value != nullptr && *value != '\0') ? std::string{value} : std::string{fallback};
  };
  return Config{.nats_url = variable("NATS_URL", default_nats_url),
                .config_path = variable("PROPAGATOR_CONFIG_PATH", default_config_path)};
}

std::string redact_url(std::string_view url) {
  const auto scheme_end = url.find("://");
  const auto authority_start = scheme_end == std::string_view::npos ? 0 : scheme_end + 3;
  const auto authority_end = url.find_first_of("/?#", authority_start);
  const auto at =
      url.rfind('@', authority_end == std::string_view::npos ? url.size() : authority_end);
  if (at == std::string_view::npos || at < authority_start) {
    return std::string{url};
  }
  return std::string{url.substr(0, authority_start)} + "***" + std::string{url.substr(at)};
}

std::chrono::milliseconds backoff_delay(const BackoffPolicy& policy, unsigned attempt) noexcept {
  auto delay = policy.initial;
  for (unsigned i = 0; i < attempt && delay < policy.max; ++i) {
    delay *= 2;
  }
  return std::min(delay, policy.max);
}

void log_json(std::ostream& out, std::string_view level, std::string_view message,
              std::initializer_list<LogField> fields) {
  out << "{\"level\":";
  write_json_string(out, level);
  out << ",\"service\":";
  write_json_string(out, service_name);
  out << ",\"msg\":";
  write_json_string(out, message);
  for (const auto& [key, value] : fields) {
    out << ',';
    write_json_string(out, key);
    out << ':';
    write_json_string(out, value);
  }
  out << "}\n" << std::flush;
}

struct NatsConnection::Impl {
  natsConnection* connection = nullptr;
  std::atomic<Health> health{Health::degraded};

  static void on_disconnected(natsConnection* /*connection*/, void* closure) {
    static_cast<Impl*>(closure)->health.store(Health::degraded);
  }
  static void on_reconnected(natsConnection* /*connection*/, void* closure) {
    static_cast<Impl*>(closure)->health.store(Health::ok);
  }
};

NatsConnection::NatsConnection() : impl_(std::make_unique<Impl>()) {}

NatsConnection::~NatsConnection() {
  if (impl_->connection != nullptr) {
    natsConnection_Destroy(impl_->connection);
  }
}

bool NatsConnection::connect(const std::string& url, std::string* error) {
  if (impl_->connection != nullptr) {
    return true;
  }
  natsOptions* options = nullptr;
  natsStatus status = natsOptions_Create(&options);
  if (status == NATS_OK) {
    status = natsOptions_SetURL(options, url.c_str());
  }
  if (status == NATS_OK) {
    status = natsOptions_SetName(options, std::string{service_name}.c_str());
  }
  if (status == NATS_OK) {
    status = natsOptions_SetTimeout(options, connect_timeout_ms);
  }
  if (status == NATS_OK) {
    status = natsOptions_SetMaxReconnect(options, -1);  // once connected, never give up
  }
  if (status == NATS_OK) {
    status = natsOptions_SetDisconnectedCB(options, &Impl::on_disconnected, impl_.get());
  }
  if (status == NATS_OK) {
    status = natsOptions_SetReconnectedCB(options, &Impl::on_reconnected, impl_.get());
  }
  if (status == NATS_OK) {
    status = natsConnection_Connect(&impl_->connection, options);
  }
  natsOptions_Destroy(options);

  if (status != NATS_OK) {
    impl_->connection = nullptr;
    impl_->health.store(Health::degraded);
    if (error != nullptr) {
      *error = natsStatus_GetText(status);
    }
    return false;
  }
  impl_->health.store(Health::ok);
  return true;
}

Health NatsConnection::health() const noexcept { return impl_->health.load(); }

natsConnection* NatsConnection::native() const noexcept { return impl_->connection; }

std::string instance_name() {
  std::array<char, 256> name{};
  if (gethostname(name.data(), name.size() - 1) == 0 && name.front() != '\0') {
    return std::string{name.data()};
  }
  return std::string{service_name};
}

int run(const Config& config, const std::atomic<bool>& stop, std::ostream& log,
        const BackoffPolicy& backoff) {
  log_json(log, "info", "starting",
           {{"version", version()},
            {"nats_url", redact_url(config.nats_url)},
            {"config_path", config.config_path}});

  const LoadedConfig loaded = load_config_file(config.config_path);
  if (!loaded.problem.empty()) {
    log_json(log, "error", "config file not used: starting with the defaults",
             {{"error", loaded.problem}});
  }

  NatsConnection nats;
  unsigned attempt = 0;
  while (!stop.load()) {
    std::string error;
    if (nats.connect(config.nats_url, &error)) {
      log_json(log, "info", "connected to NATS", {{"health", to_string(nats.health())}});
      break;
    }
    const auto delay = backoff_delay(backoff, attempt++);
    log_json(log, "error", "cannot connect to NATS",
             {{"error", error},
              {"health", to_string(nats.health())},
              {"retry_in_ms", std::to_string(delay.count())}});
    sleep_unless_stopped(delay, stop);
  }

  if (!stop.load()) {
    constexpr std::chrono::milliseconds max_fetch_wait{1'000};
    const std::string instance = instance_name();
    NatsConfig propagation_config(nats.native(), log, instance, config.config_path, loaded);
    NatsPipeline pipeline(nats.native(), log, instance);
    auto next_heartbeat = std::chrono::steady_clock::now();
    while (!stop.load()) {
      // PERF: a config set waits for the launch fetch in progress (<= 1 s).
      propagation_config.poll();
      const auto now = std::chrono::steady_clock::now();
      if (now >= next_heartbeat) {
        pipeline.heartbeat(nats.health(), propagation_config.version(),
                           propagation_config.problem());
        next_heartbeat += heartbeat_interval;
        if (next_heartbeat <= now) {
          next_heartbeat = now + heartbeat_interval;  // fell behind: no burst
        }
      }
      const auto until_heartbeat = std::chrono::duration_cast<std::chrono::milliseconds>(
          next_heartbeat - std::chrono::steady_clock::now());
      pipeline.poll(std::clamp(until_heartbeat, stop_poll, max_fetch_wait));
    }
  }
  log_json(log, "info", "stopping");
  return EXIT_SUCCESS;
}

}  // namespace propagator
