package trajectory.store;

import java.io.IOException;
import java.io.StringReader;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.postgresql.PGConnection;
import trajectory.v1.Launch.LaunchRequest;
import trajectory.v1.Launch.PropagationConfig;
import trajectory.v1.Trajectory.TrajectoryComputed;

/**
 * The PostgreSQL adapter of {@link TrajectoryRepository}: one transaction per trajectory, the
 * launch row with {@code INSERT ... ON CONFLICT DO NOTHING} (idempotent on launch_id, also between
 * replicas), the samples with COPY. One connection, opened on first use and reopened after a
 * failure or when the credentials in force change; used by one thread (the consumer).
 */
public final class PostgresTrajectoryRepository implements TrajectoryRepository {
  /** Opens a connection as a database user. */
  @FunctionalInterface
  public interface ConnectionFactory {
    /** A new connection with {@code credentials}. */
    Connection open(DbCredentials credentials) throws SQLException;
  }

  private final ConnectionFactory factory;
  private Connection conn;
  private DbCredentials connCredentials;

  /**
   * Creates the adapter; nothing is opened before the first {@link #save}.
   *
   * @param factory opens the connections
   */
  public PostgresTrajectoryRepository(ConnectionFactory factory) {
    this.factory = factory;
  }

  @Override
  public Saved save(TrajectoryComputed t, TablePrefix prefix, DbCredentials credentials)
      throws UnavailableException, RejectedException {
    try {
      Connection c = connection(credentials);
      try {
        Saved saved = insert(c, t, prefix);
        c.commit();
        return saved;
      } catch (SQLException | IOException | RuntimeException e) {
        rollback(c);
        throw e;
      }
    } catch (SQLException e) {
      if (isRejected(e)) {
        throw new RejectedException("database refused the trajectory: " + describe(e), e);
      }
      close();
      throw new UnavailableException("database unavailable: " + describe(e), e);
    } catch (IOException e) {
      close();
      throw new UnavailableException("database unavailable: " + describe(e), e);
    }
  }

  private Saved insert(Connection c, TrajectoryComputed t, TablePrefix prefix)
      throws SQLException, IOException {
    UUID id = UUID.fromString(t.getLaunchId());
    LaunchRequest r = t.getRequest();
    PropagationConfig cfg = t.getConfig();
    String sql =
        "INSERT INTO " + prefix.launches()
            + " (id, received_at, computed_at, mass_kg, x_m, y_m, z_m, azimuth_deg,"
            + " elevation_deg, force_n, burn_duration_s, propagation_time_s, sample_step_s,"
            + " gravity_mps2, config_version, status, end_reason, flight_time_s, max_height_m,"
            + " range_m, sample_count)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            + " ON CONFLICT (id) DO NOTHING RETURNING stored_at";
    try (PreparedStatement ps = c.prepareStatement(sql)) {
      int i = 1;
      ps.setObject(i++, id);
      ps.setObject(i++, TrajectoryRows.timestamp(t.getAcceptedAt()));
      ps.setObject(i++, TrajectoryRows.timestamp(t.getComputedAt()));
      ps.setDouble(i++, r.getMassKg());
      ps.setDouble(i++, r.getPosition().getXM());
      ps.setDouble(i++, r.getPosition().getYM());
      ps.setDouble(i++, r.getPosition().getZM());
      ps.setDouble(i++, r.getAzimuthDeg());
      ps.setDouble(i++, r.getElevationDeg());
      ps.setDouble(i++, r.getForceN());
      ps.setDouble(i++, r.getBurnDurationS());
      ps.setDouble(i++, cfg.getPropagationTimeS());
      ps.setDouble(i++, cfg.getSampleStepS());
      ps.setDouble(i++, cfg.getGravityMps2());
      ps.setLong(i++, cfg.getConfigVersion());
      ps.setString(i++, TrajectoryRows.STATUS_STORED);
      ps.setString(i++, TrajectoryRows.endReason(t.getEndReason()));
      ps.setDouble(i++, t.getFlightTimeS());
      ps.setDouble(i++, t.getMaxHeightM());
      ps.setDouble(i++, t.getRangeM());
      ps.setInt(i, t.getSamplesCount());
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          copySamples(c, t, id, prefix);
          return new Saved(false, t.getSamplesCount(), instant(rs.getTimestamp(1)));
        }
      }
    }
    // already stored (by an earlier delivery or another replica): read what is there
    try (PreparedStatement ps =
        c.prepareStatement(
            "SELECT sample_count, stored_at FROM " + prefix.launches() + " WHERE id = ?")) {
      ps.setObject(1, id);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw new SQLException("launch row vanished after a conflict", "40001");
        }
        return new Saved(true, rs.getInt(1), instant(rs.getTimestamp(2)));
      }
    }
  }

  private static void copySamples(Connection c, TrajectoryComputed t, UUID id, TablePrefix prefix)
      throws SQLException, IOException {
    // PERF: the whole COPY text in memory (about 10 MB for 100000 samples); stream it if needed
    StringBuilder text = new StringBuilder(t.getSamplesCount() * 120);
    String launchId = id.toString(); // canonical: hex digits and dashes only
    for (var s : t.getSamplesList()) {
      TrajectoryRows.appendCopyLine(text, launchId, s);
    }
    c.unwrap(PGConnection.class)
        .getCopyAPI()
        .copyIn(
            "COPY " + prefix.samples()
                + " (launch_id, seq, t_s, x_m, y_m, z_m, vx_mps, vy_mps, vz_mps, phase)"
                + " FROM STDIN (FORMAT text)",
            new StringReader(text.toString()));
  }

  /**
   * SQL state classes 22 (data exception) and 23 (integrity constraint violation): these values
   * will never be accepted. Every other failure (class 08, an admin shutdown, no state) is
   * treated as the database being unavailable and retried, so nothing is lost.
   */
  static boolean isRejected(SQLException e) {
    String state = e.getSQLState();
    return state != null && (state.startsWith("22") || state.startsWith("23"));
  }

  private Connection connection(DbCredentials credentials) throws SQLException {
    if (conn != null && !credentials.equals(connCredentials)) {
      close(); // new credentials in force: the next writes go through the new user
    }
    if (conn == null || conn.isClosed()) {
      Connection c = factory.open(credentials);
      c.setAutoCommit(false);
      conn = c;
      connCredentials = credentials;
    }
    return conn;
  }

  private static void rollback(Connection c) {
    try {
      c.rollback();
    } catch (SQLException ignored) {
      // the connection is broken: it is closed and reopened by the caller
    }
  }

  /** Closes the connection; the next {@link #save} opens a new one. */
  public void close() {
    Connection c = conn;
    conn = null;
    connCredentials = null;
    if (c != null) {
      try {
        c.close();
      } catch (SQLException ignored) {
        // already broken
      }
    }
  }

  private static Instant instant(Timestamp ts) {
    return ts.toInstant();
  }

  /** The first line of the error with its SQL state; no value of the row (no data, no secret). */
  private static String describe(Exception e) {
    String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    int end = msg.indexOf('\n');
    String line = end < 0 ? msg : msg.substring(0, end);
    if (e instanceof SQLException sql && sql.getSQLState() != null) {
      return line + " (SQL state " + sql.getSQLState() + ")";
    }
    return line;
  }
}
