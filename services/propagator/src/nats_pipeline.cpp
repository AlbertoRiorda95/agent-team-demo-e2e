#include "nats_pipeline.hpp"

#include <string_view>
#include <thread>
#include <utility>

#include "propagator/pipeline.hpp"

namespace propagator {

namespace {

using std::chrono::milliseconds;
using std::chrono::nanoseconds;

/// The ack wait of the consumer (docs/design/propagation.md > NATS objects).
constexpr nanoseconds ack_wait{std::chrono::seconds{30}};
/// How long a failed publish waits before the input is redelivered.
constexpr nanoseconds nak_delay{std::chrono::seconds{5}};
/// How long a JetStream publish waits for the stream ack.
constexpr milliseconds publish_wait{5'000};

std::string status_text(natsStatus status, jsErrCode code) {
  std::string text = natsStatus_GetText(status);
  if (code != 0) {
    text += " (jetstream error " + std::to_string(static_cast<int>(code)) + ")";
  }
  return text;
}

std::string_view payload_of(natsMsg* message) {
  const char* data = natsMsg_GetData(message);
  const int length = natsMsg_GetDataLength(message);
  return data == nullptr || length <= 0
             ? std::string_view{}
             : std::string_view{data, static_cast<std::string_view::size_type>(length)};
}

}  // namespace

NatsPipeline::NatsPipeline(natsConnection* connection, std::ostream& log, std::string instance)
    : connection_(connection), log_(log), instance_(std::move(instance)) {}

NatsPipeline::~NatsPipeline() {
  drop_subscription();
  if (js_ != nullptr) {
    jsCtx_Destroy(js_);
  }
}

void NatsPipeline::drop_subscription() {
  if (subscription_ != nullptr) {
    natsSubscription_Destroy(subscription_);
    subscription_ = nullptr;
  }
}

bool NatsPipeline::ensure_subscription() {
  if (subscription_ != nullptr) {
    return true;
  }
  natsStatus status = NATS_OK;
  jsErrCode code{};
  if (js_ == nullptr) {
    status = natsConnection_JetStream(&js_, connection_, nullptr);
  }

  // The durable pull consumer, shared by the replicas: creating it again with
  // the same config is a no-op on the server.
  const std::string stream{launches_stream};
  const std::string durable{consumer_name};
  const std::string filter{launches_accepted_subject};
  if (status == NATS_OK) {
    jsConsumerConfig config;
    jsConsumerConfig_Init(&config);
    config.Durable = durable.c_str();
    config.FilterSubject = filter.c_str();
    config.AckPolicy = js_AckExplicit;
    config.AckWait = ack_wait.count();
    config.DeliverPolicy = js_DeliverAll;
    jsConsumerInfo* info = nullptr;
    status = js_AddConsumer(&info, js_, stream.c_str(), &config, nullptr, &code);
    jsConsumerInfo_Destroy(info);
  }
  if (status == NATS_OK) {
    jsSubOptions options;
    jsSubOptions_Init(&options);
    options.Stream = stream.c_str();
    options.Consumer = durable.c_str();
    status = js_PullSubscribe(&subscription_, js_, filter.c_str(), durable.c_str(), nullptr,
                              &options, &code);
  }
  if (status != NATS_OK) {
    subscription_ = nullptr;
    const std::string problem = "consumer missing: " + status_text(status, code);
    if (problem != consumer_problem_) {
      log_json(log_, "error", "cannot create the consumer",
               {{"stream", stream}, {"consumer", durable}, {"error", problem}});
    }
    consumer_problem_ = problem;
    return false;
  }
  if (!consumer_problem_.empty()) {
    log_json(log_, "info", "consumer ready", {{"stream", stream}, {"consumer", durable}});
  }
  consumer_problem_.clear();
  return true;
}

void NatsPipeline::poll(milliseconds wait) {
  if (natsConnection_Status(connection_) != NATS_CONN_STATUS_CONNECTED || !ensure_subscription()) {
    std::this_thread::sleep_for(wait);
    return;
  }
  natsMsgList list{};
  jsErrCode code{};
  const natsStatus status = natsSubscription_Fetch(&list, subscription_, 1, wait.count(), &code);
  if (status == NATS_TIMEOUT || status == NATS_NOT_FOUND) {
    return;  // nothing to do
  }
  if (status != NATS_OK) {
    if (natsConnection_Status(connection_) == NATS_CONN_STATUS_CONNECTED) {
      // The consumer was deleted or the server refused the pull: create it again.
      consumer_problem_ = "consumer missing: " + status_text(status, code);
      log_json(log_, "error", "cannot fetch from the consumer", {{"error", consumer_problem_}});
      drop_subscription();
    }
    std::this_thread::sleep_for(wait);
    return;
  }
  for (int i = 0; i < list.Count; ++i) {
    // NOLINTNEXTLINE(cppcoreguidelines-pro-bounds-pointer-arithmetic): the C list
    handle(list.Msgs[i]);
  }
  natsMsgList_Destroy(&list);
}

void NatsPipeline::handle(natsMsg* message) {
  const auto started = std::chrono::steady_clock::now();
  LaunchOutcome outcome = handle_launch(payload_of(message), std::chrono::system_clock::now());
  const auto elapsed_ms = [&] {
    return std::to_string(
        std::chrono::duration_cast<milliseconds>(std::chrono::steady_clock::now() - started)
            .count());
  };

  jsErrCode code{};
  jsPubOptions options;
  jsPubOptions_Init(&options);
  options.MaxWait = publish_wait.count();

  if (outcome.kind == LaunchOutcome::Kind::rejected) {
    // Invalid input: reported on pipeline.errors and terminated, never passed on.
    const std::string bytes = outcome.error.SerializeAsString();
    jsPubAck* ack = nullptr;
    const natsStatus status =
        js_Publish(&ack, js_, std::string{pipeline_errors_subject}.c_str(), bytes.data(),
                   static_cast<int>(bytes.size()), &options, &code);
    jsPubAck_Destroy(ack);
    natsMsg_Term(message, nullptr);
    log_json(log_, "warn", "launch rejected",
             {{"launch_id", outcome.launch_id},
              {"outcome", "rejected"},
              {"reason", outcome.error.message()},
              {"duration_ms", elapsed_ms()}});
    if (status != NATS_OK) {
      log_json(log_, "error", "cannot publish the pipeline error",
               {{"launch_id", outcome.launch_id}, {"error", status_text(status, code)}});
    }
    return;
  }

  // PERF: one copy of up to ~7 MB per launch (proto/README.md > Sample cap).
  const std::string bytes = outcome.trajectory.SerializeAsString();
  options.MsgId = outcome.launch_id.c_str();
  jsPubAck* ack = nullptr;
  const natsStatus status =
      js_Publish(&ack, js_, std::string{trajectories_computed_subject}.c_str(), bytes.data(),
                 static_cast<int>(bytes.size()), &options, &code);
  const bool duplicate = ack != nullptr && ack->Duplicate;
  jsPubAck_Destroy(ack);
  if (status != NATS_OK) {
    // Not stored: leave the input to be redelivered later.
    publish_problem_ = "publish failed: " + status_text(status, code);
    natsMsg_NakWithDelay(message, std::chrono::duration_cast<milliseconds>(nak_delay).count(),
                         nullptr);
    log_json(log_, "error", "cannot publish the trajectory",
             {{"launch_id", outcome.launch_id},
              {"outcome", "retry"},
              {"error", publish_problem_},
              {"duration_ms", elapsed_ms()}});
    return;
  }
  publish_problem_.clear();
  natsMsg_Ack(message, nullptr);
  log_json(log_, "info", "launch computed",
           {{"launch_id", outcome.launch_id},
            {"outcome", duplicate ? "duplicate" : "computed"},
            {"samples", std::to_string(outcome.trajectory.samples_size())},
            {"duration_ms", elapsed_ms()}});
}

void NatsPipeline::heartbeat(Health connection, std::uint64_t config_version) {
  std::string reason;
  if (connection != Health::ok) {
    reason = "NATS disconnected";
  } else if (!consumer_problem_.empty()) {
    reason = consumer_problem_;
  } else if (!publish_problem_.empty()) {
    reason = publish_problem_;
  }
  const std::string bytes =
      make_status(instance_, reason, config_version, std::chrono::system_clock::now())
          .SerializeAsString();
  // Fire and forget: a heartbeat has no value once old (core NATS, no stream).
  natsConnection_Publish(connection_, std::string{status_subject}.c_str(), bytes.data(),
                         static_cast<int>(bytes.size()));
}

}  // namespace propagator
