// Internal helper: a `std::chrono` time point as a `google.protobuf.Timestamp`.
#pragma once

#include <google/protobuf/timestamp.pb.h>

#include <chrono>
#include <cstdint>

namespace propagator {

inline void stamp(google::protobuf::Timestamp* timestamp,
                  std::chrono::system_clock::time_point now) {
  const auto since_epoch = now.time_since_epoch();
  const auto seconds = std::chrono::floor<std::chrono::seconds>(since_epoch);
  const auto nanos = std::chrono::duration_cast<std::chrono::nanoseconds>(since_epoch - seconds);
  timestamp->set_seconds(seconds.count());
  timestamp->set_nanos(static_cast<std::int32_t>(nanos.count()));
}

}  // namespace propagator
