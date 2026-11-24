package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import io.nats.client.Connection;
import io.nats.client.Message;
import io.nats.client.Nats;
import io.nats.client.PublishOptions;
import io.nats.client.Subscription;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.Test;
import org.testcontainers.DockerClientFactory;
import trajectory.v1.Service.ServiceStatus;
import trajectory.v1.Trajectory.TrajectoryComputed;
import trajectory.v1.Trajectory.TrajectoryStored;

/**
 * Integration: PostgreSQL stopped while a trajectory arrives, then started again. The store keeps
 * running, reports {@code degraded} meanwhile and stores the trajectory once the database is back.
 * PostgreSQL gets a fixed host port so that it keeps it across the restart.
 */
class DatabaseOutageTest {
  /** A free host port below the range Docker assigns from (32768 and up). */
  private static int freePort() throws IOException {
    for (int i = 0; i < 50; i++) {
      int port = ThreadLocalRandom.current().nextInt(20000, 32000);
      try (ServerSocket s = new ServerSocket(port)) {
        return s.getLocalPort();
      } catch (IOException taken) {
        // try another one
      }
    }
    throw new IOException("no free port");
  }

  @Test
  void aTrajectoryWaitsForTheDatabaseWithoutARestart() throws Exception {
    int pgPort = freePort();
    try (var postgres =
            TestInfra.postgres()
                .withCreateContainerCmdModifier(
                    cmd ->
                        cmd.getHostConfig()
                            .withPortBindings(
                                new PortBinding(
                                    Ports.Binding.bindPort(pgPort), new ExposedPort(5432))));
        var natsServer = TestInfra.nats()) {
      postgres.start();
      natsServer.start();
      TestInfra.createStreams(natsServer);
      ByteArrayOutputStream logs = new ByteArrayOutputStream();
      Connection nats = Nats.connect(TestInfra.natsUrl(natsServer));
      try (StoreService store =
          new StoreService(
              TestInfra.config(postgres, pgPort, TestInfra.natsUrl(natsServer)),
              new JsonLog(new PrintStream(logs, true, StandardCharsets.UTF_8)),
              Thread::sleep,
              Duration.ofSeconds(1))) {
        store.start();
        assertEquals(Health.OK, store.health());
        var docker = DockerClientFactory.instance().client();
        docker.stopContainerCmd(postgres.getContainerId()).withTimeout(10).exec();

        Subscription stored = nats.subscribe(Subjects.TRAJECTORIES_STORED);
        Subscription status = nats.subscribe(Subjects.STATUS);
        TrajectoryComputed t = Trajectories.valid(UUID.randomUUID().toString(), 6001);
        nats.jetStream()
            .publish(
                Subjects.TRAJECTORIES_COMPUTED,
                t.toByteArray(),
                PublishOptions.builder().messageId(t.getLaunchId()).build());

        ServiceStatus degraded = awaitState(status, ServiceStatus.State.STATE_DEGRADED);
        assertTrue(degraded.getDetail().contains("database unavailable"), degraded.getDetail());

        docker.startContainerCmd(postgres.getContainerId()).exec();
        Message m = stored.nextMessage(Duration.ofSeconds(60));
        assertNotNull(m, "not stored after the restart; logs: " + logs.toString(StandardCharsets.UTF_8));
        assertEquals(6001, TrajectoryStored.parseFrom(m.getData()).getSampleCount());
        awaitState(status, ServiceStatus.State.STATE_OK);
        assertEquals(Health.OK, store.health());

        try (var conn =
                DriverManager.getConnection(
                    "jdbc:postgresql://" + postgres.getHost() + ":" + pgPort + "/"
                        + postgres.getDatabaseName(),
                    postgres.getUsername(),
                    postgres.getPassword());
            var ps =
                conn.prepareStatement("SELECT count(*) FROM trajectory_samples WHERE launch_id = ?")) {
          ps.setObject(1, UUID.fromString(t.getLaunchId()));
          try (var rs = ps.executeQuery()) {
            rs.next();
            assertEquals(6001, rs.getInt(1));
          }
        }
        String text = logs.toString(StandardCharsets.UTF_8);
        assertTrue(text.contains("\"outcome\":\"retry\""), text);
        assertTrue(!text.contains(postgres.getPassword()), "the password is not logged");
      } finally {
        nats.close();
      }
    }
  }

  private static ServiceStatus awaitState(Subscription status, ServiceStatus.State state)
      throws Exception {
    long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
    while (System.nanoTime() < deadline) {
      Message m = status.nextMessage(Duration.ofSeconds(2));
      if (m != null) {
        ServiceStatus s = ServiceStatus.parseFrom(m.getData());
        if (s.getState() == state) {
          return s;
        }
      }
    }
    throw new AssertionError("no heartbeat " + state);
  }
}
