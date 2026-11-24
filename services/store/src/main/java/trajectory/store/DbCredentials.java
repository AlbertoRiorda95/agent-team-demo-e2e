package trajectory.store;

/**
 * The database write credentials in force: from {@code DATABASE_USER} and {@code
 * DATABASE_PASSWORD}, or opened from the sealed bytes of a {@code StoreConfig}. Only in memory.
 *
 * @param user the database user
 * @param password the password (never logged, never printed)
 */
public record DbCredentials(String user, String password) {
  /** Hides the password. */
  @Override
  public String toString() {
    return "DbCredentials[user=" + user + ", password=***]";
  }
}
