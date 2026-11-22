package trajectory.store;

import java.io.PrintStream;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Structured logs: one JSON object per line, {"ts":...,"level":...,"service":"store","msg":...}. */
public final class JsonLog {
  private final PrintStream out;

  /**
   * Creates a log that writes to {@code out}.
   *
   * @param out where the lines go (standard error in the service)
   */
  public JsonLog(PrintStream out) {
    this.out = out;
  }

  /** Writes an {@code info} line. */
  public void info(String msg, Map<String, String> fields) {
    write("info", msg, fields);
  }

  /** Writes a {@code warn} line. */
  public void warn(String msg, Map<String, String> fields) {
    write("warn", msg, fields);
  }

  /** Writes an {@code error} line. */
  public void error(String msg, Map<String, String> fields) {
    write("error", msg, fields);
  }

  private void write(String level, String msg, Map<String, String> fields) {
    out.println(format(Instant.now(), level, msg, fields));
  }

  /** The JSON line for one entry; the extra fields follow {@code msg}, in their order. */
  static String format(Instant ts, String level, String msg, Map<String, String> fields) {
    Map<String, String> all = new LinkedHashMap<>();
    all.put("ts", ts.toString());
    all.put("level", level);
    all.put("service", "store");
    all.put("msg", msg);
    all.putAll(fields);
    StringBuilder line = new StringBuilder("{");
    all.forEach(
        (key, value) -> {
          if (line.length() > 1) {
            line.append(',');
          }
          quote(line, key).append(':');
          quote(line, value == null ? "" : value);
        });
    return line.append('}').toString();
  }

  private static StringBuilder quote(StringBuilder sb, String s) {
    sb.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> sb.append("\\\"");
        case '\\' -> sb.append("\\\\");
        case '\n' -> sb.append("\\n");
        case '\r' -> sb.append("\\r");
        case '\t' -> sb.append("\\t");
        default -> {
          if (c < 0x20) {
            sb.append(String.format("\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
        }
      }
    }
    return sb.append('"');
  }
}
