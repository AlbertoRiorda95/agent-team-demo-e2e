package trajectory.store;

import java.util.regex.Pattern;

/**
 * The table prefix in force: empty (tables {@code launches}, {@code trajectory_samples}) or
 * {@code ^[a-z][a-z0-9_]{0,15}$}, used as is ({@code demo_} gives {@code demo_launches}). Only a
 * validated value reaches SQL, so it is safe to put in a table name.
 *
 * @param value the prefix, possibly empty
 */
public record TablePrefix(String value) {
  private static final Pattern PATTERN = Pattern.compile("[a-z][a-z0-9_]{0,15}");

  /** The default: no prefix. */
  public static final TablePrefix NONE = new TablePrefix("");

  /**
   * Validates the prefix.
   *
   * @throws IllegalArgumentException when it is neither empty nor matches the pattern
   */
  public TablePrefix {
    if (value == null || !(value.isEmpty() || PATTERN.matcher(value).matches())) {
      throw new IllegalArgumentException("table prefix must be empty or match ^[a-z][a-z0-9_]{0,15}$");
    }
  }

  /** The launches table: {@code <prefix>launches}. */
  public String launches() {
    return value + "launches";
  }

  /** The samples table: {@code <prefix>trajectory_samples}. */
  public String samples() {
    return value + "trajectory_samples";
  }

  /** The Flyway history table: {@code <prefix>flyway_schema_history}. */
  public String flywayHistory() {
    return value + "flyway_schema_history";
  }
}
