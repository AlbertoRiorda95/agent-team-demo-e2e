package trajectory.store;

import java.util.Map;
import java.util.concurrent.CountDownLatch;

/** Entry point: validates the environment, starts {@link StoreService} and runs until stopped. */
public final class Main {
  private Main() {}

  /**
   * Starts the store.
   *
   * @param args none
   * @throws InterruptedException when stopped
   */
  public static void main(String[] args) throws InterruptedException {
    JsonLog log = new JsonLog(System.err);
    StoreConfig config;
    try {
      config = StoreConfig.fromEnvironment(System.getenv());
    } catch (IllegalArgumentException e) {
      log.error("invalid configuration", Map.of("error", e.getMessage()));
      System.exit(2);
      return;
    }
    log.info(
        "starting",
        Map.of("database_url", config.jdbcUrl().split("\\?", 2)[0], // no query: it may carry options
            "nats_url", StoreConfig.redact(config.natsUrl())));

    StoreService service = new StoreService(config, log, delay -> Thread.sleep(delay));
    CountDownLatch stopped = new CountDownLatch(1);
    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  service.close();
                  log.info("stopped", Map.of());
                  stopped.countDown();
                }));
    service.start();
    log.info("started", Map.of("health", service.health().toString()));
    stopped.await();
  }
}
