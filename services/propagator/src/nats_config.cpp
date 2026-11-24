#include "nats_config.hpp"

#include <chrono>
#include <utility>

#include "propagator/propagator.hpp"

namespace propagator {

namespace {

/// How long a JetStream publish waits for the stream ack.
constexpr std::int64_t publish_wait_ms = 5'000;

std::string_view payload_of(natsMsg* message) {
  const char* data = natsMsg_GetData(message);
  const int length = natsMsg_GetDataLength(message);
  return data == nullptr || length <= 0
             ? std::string_view{}
             : std::string_view{data, static_cast<std::string_view::size_type>(length)};
}

std::string_view kind_text(ConfigDecision::Kind kind) {
  switch (kind) {
    case ConfigDecision::Kind::apply:
      return "applied";
    case ConfigDecision::Kind::acknowledge:
      return "acknowledged";
    case ConfigDecision::Kind::reject:
      break;
  }
  return "rejected";
}

}  // namespace

NatsConfig::NatsConfig(natsConnection* connection, std::ostream& log, std::string instance,
                       std::filesystem::path path, const LoadedConfig& loaded)
    : connection_(connection),
      log_(log),
      instance_(std::move(instance)),
      path_(std::move(path)),
      in_force_(loaded.config),
      file_problem_(loaded.problem) {}

NatsConfig::~NatsConfig() {
  if (subscription_ != nullptr) {
    natsSubscription_Destroy(subscription_);
  }
  if (js_ != nullptr) {
    jsCtx_Destroy(js_);
  }
}

std::string NatsConfig::problem() const {
  if (!file_problem_.empty()) {
    return file_problem_;
  }
  return publish_problem_;
}

bool NatsConfig::publish_applied(bool ok, std::string_view error) {
  const std::string bytes =
      make_config_applied(instance_, in_force_, ok, error, std::chrono::system_clock::now())
          .SerializeAsString();
  jsPubOptions options;
  jsPubOptions_Init(&options);
  options.MaxWait = publish_wait_ms;
  jsPubAck* ack = nullptr;
  jsErrCode code{};
  const natsStatus status =
      js_Publish(&ack, js_, std::string{config_applied_subject}.c_str(), bytes.data(),
                 static_cast<int>(bytes.size()), &options, &code);
  jsPubAck_Destroy(ack);
  if (status != NATS_OK) {
    std::string problem = std::string{"config answer not published: "} + natsStatus_GetText(status);
    if (code != 0) {
      problem += " (jetstream error " + std::to_string(static_cast<int>(code)) + ")";
    }
    if (problem != publish_problem_) {
      log_json(log_, "error", "cannot publish the config answer",
               {{"config_version", std::to_string(in_force_.version)}, {"error", problem}});
    }
    publish_problem_ = std::move(problem);
    return false;
  }
  publish_problem_.clear();
  return true;
}

bool NatsConfig::ensure_started() {
  if (natsConnection_Status(connection_) != NATS_CONN_STATUS_CONNECTED) {
    return false;
  }
  if (js_ == nullptr && natsConnection_JetStream(&js_, connection_, nullptr) != NATS_OK) {
    js_ = nullptr;
    return false;
  }
  if (subscription_ == nullptr) {
    // Core NATS: only the sets published from now on (M6 reads the latest of
    // the stream instead). The client subscribes again after a reconnection.
    const natsStatus status = natsConnection_SubscribeSync(&subscription_, connection_,
                                                           std::string{config_set_subject}.c_str());
    if (status != NATS_OK) {
      subscription_ = nullptr;
      log_json(log_, "error", "cannot subscribe to the config",
               {{"subject", config_set_subject}, {"error", natsStatus_GetText(status)}});
      return false;
    }
    // The subscription is on the server before the start-up answer tells
    // anyone that this instance is listening.
    natsConnection_Flush(connection_);
  }
  if (!startup_published_ && publish_applied(true, {})) {
    startup_published_ = true;
    log_json(log_, "info", "config in force",
             {{"config_version", std::to_string(in_force_.version)},
              {"propagation_time_s", std::to_string(in_force_.propagation_time_s)},
              {"sample_step_s", std::to_string(in_force_.sample_step_s)}});
  }
  return true;
}

void NatsConfig::poll() {
  if (!ensure_started()) {
    return;
  }
  for (;;) {
    natsMsg* message = nullptr;
    if (natsSubscription_NextMsg(&message, subscription_, 0) != NATS_OK) {
      return;  // nothing more for now
    }
    handle(message);
    natsMsg_Destroy(message);
  }
}

void NatsConfig::handle(natsMsg* message) {
  const ConfigDecision decision = decide_config_set(payload_of(message), in_force_);
  if (decision.kind == ConfigDecision::Kind::apply) {
    // Saved first, so that a restart finds it; in force even when the file is
    // unwritable (status degraded until a later save works).
    if (auto error = save_config_file(path_, decision.config)) {
      file_problem_ = "local file unwritable: " + *error;
      log_json(log_, "error", "cannot save the config", {{"error", file_problem_}});
    } else {
      file_problem_.clear();
    }
    in_force_ = decision.config;
  }
  const bool ok = decision.kind != ConfigDecision::Kind::reject;
  publish_applied(ok, decision.error);
  log_json(log_, ok ? "info" : "warn", "config set",
           {{"version", std::to_string(decision.requested_version)},
            {"ok", ok ? "true" : "false"},
            {"outcome", kind_text(decision.kind)},
            {"error", decision.error},
            {"config_version", std::to_string(in_force_.version)}});
}

}  // namespace propagator
