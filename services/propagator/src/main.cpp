// The propagator process: runs the library's entry point until SIGINT or SIGTERM.
#include <nats/nats.h>

#include <atomic>
#include <csignal>
#include <cstdlib>
#include <iostream>

#include "propagator/propagator.hpp"

namespace {

// Set by the signal handler, hence global and mutable.
// NOLINTNEXTLINE(cppcoreguidelines-avoid-non-const-global-variables)
std::atomic<bool> stop_requested{false};

extern "C" void request_stop(int /*signal*/) { stop_requested.store(true); }

}  // namespace

int main() {
  static_assert(std::atomic<bool>::is_always_lock_free,
                "the signal handler needs a lock-free flag");
  if (std::signal(SIGINT, request_stop) == SIG_ERR ||
      std::signal(SIGTERM, request_stop) == SIG_ERR) {
    propagator::log_json(std::cerr, "error", "cannot install the signal handlers");
    return EXIT_FAILURE;
  }

  const int code = propagator::run(propagator::config_from_env(), stop_requested, std::cerr);
  nats_Close();
  return code;
}
