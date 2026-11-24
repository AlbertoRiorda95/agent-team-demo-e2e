package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/** Unit: only a prefix that matches the pattern can reach a table name. */
class TablePrefixTest {
  @Test
  void namesTheTablesOfThePrefix() {
    assertEquals("launches", TablePrefix.NONE.launches());
    var demo = new TablePrefix("demo_");
    assertEquals("demo_launches", demo.launches());
    assertEquals("demo_trajectory_samples", demo.samples());
    assertEquals("demo_flyway_schema_history", demo.flywayHistory());
    new TablePrefix("a234567890123456"); // 16 characters: the longest
  }

  @Test
  void refusesAnythingElse() {
    for (String bad :
        new String[] {"Demo_", "1demo", "_demo", "demo-", "a2345678901234567", "x; drop", " "}) {
      assertThrows(IllegalArgumentException.class, () -> new TablePrefix(bad), bad);
    }
    assertThrows(IllegalArgumentException.class, () -> new TablePrefix(null));
  }
}
