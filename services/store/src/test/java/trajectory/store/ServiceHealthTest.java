package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import trajectory.v1.Service.ServiceStatus;

/** Unit: the health report and the heartbeat message built from it. */
class ServiceHealthTest {
  @Test
  void okOnlyWhenEverythingIsUp() {
    var health = new ServiceHealth();
    assertEquals(
        new ServiceHealth.Report(
            Health.DEGRADED, "database unavailable; not connected to NATS; consumer not ready"),
        health.report());
    health.database(true);
    health.nats(true);
    health.consumer(true);
    assertEquals(new ServiceHealth.Report(Health.OK, ""), health.report());
    health.database(false);
    assertEquals(new ServiceHealth.Report(Health.DEGRADED, "database unavailable"), health.report());
  }

  @Test
  void heartbeatCarriesTheStateTheReasonAndTheConfigVersion() {
    var health = new ServiceHealth();
    health.nats(true);
    health.consumer(true);
    var beat =
        new Heartbeat(null, health, () -> 7L, "store-0", "0.0.0", new JsonLog(System.err),
            Heartbeat.INTERVAL);
    ServiceStatus msg = beat.message(Instant.ofEpochSecond(100, 5));
    assertEquals("store", msg.getService());
    assertEquals("store-0", msg.getInstance());
    assertEquals(ServiceStatus.State.STATE_DEGRADED, msg.getState());
    assertEquals("database unavailable", msg.getDetail());
    assertEquals("0.0.0", msg.getVersion());
    assertEquals(7L, msg.getConfigVersion());
    assertEquals(100, msg.getSentAt().getSeconds());
    assertEquals(5, msg.getSentAt().getNanos());
  }
}
