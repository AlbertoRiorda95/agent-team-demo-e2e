package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Smoke test: the configuration read from the environment, at the edge of the service. */
class StoreConfigTest {
  private static Map<String, String> env() {
    Map<String, String> env = new HashMap<>();
    env.put("DATABASE_URL", "postgresql://localhost:5432/trajectory");
    env.put("DATABASE_USER", "trajectory");
    env.put("DATABASE_PASSWORD", "secret-value");
    env.put("NATS_URL", "nats://localhost:4222");
    return env;
  }

  @Test
  void readsTheVariablesOfEnvExample() {
    StoreConfig config = StoreConfig.fromEnvironment(env());
    assertEquals("jdbc:postgresql://localhost:5432/trajectory", config.jdbcUrl());
    assertEquals("trajectory", config.databaseUser());
    assertEquals("secret-value", config.databasePassword());
    assertEquals("nats://localhost:4222", config.natsUrl());
  }

  @Test
  void natsUrlDefaultsToLocalhost() {
    Map<String, String> env = env();
    env.remove("NATS_URL");
    assertEquals(StoreConfig.DEFAULT_NATS_URL, StoreConfig.fromEnvironment(env).natsUrl());
  }

  @Test
  void acceptsJdbcFormAndKeepsQuery() {
    assertEquals(
        "jdbc:postgresql://db:6543/x?sslmode=require",
        StoreConfig.toJdbcUrl("jdbc:postgresql://db:6543/x?sslmode=require"));
    assertEquals("jdbc:postgresql://db/x", StoreConfig.toJdbcUrl("postgres://db/x"));
  }

  @Test
  void missingVariableIsNamedWithoutValues() {
    for (String name : new String[] {"DATABASE_URL", "DATABASE_USER", "DATABASE_PASSWORD"}) {
      Map<String, String> env = env();
      env.put(name, " ");
      var e = assertThrows(IllegalArgumentException.class, () -> StoreConfig.fromEnvironment(env));
      assertEquals(name + " is not set", e.getMessage());
    }
  }

  @Test
  void rejectsInvalidUrls() {
    for (String url :
        new String[] {
          "mysql://db/x", "postgresql://db", "postgresql:///x", "not a url", "postgresql://u:p@db/x"
        }) {
      Map<String, String> env = env();
      env.put("DATABASE_URL", url);
      var e = assertThrows(IllegalArgumentException.class, () -> StoreConfig.fromEnvironment(env));
      assertTrue(e.getMessage().startsWith("DATABASE_URL"), e.getMessage());
      assertFalse(e.getMessage().contains("p@db"), "the URL value is not echoed");
    }
    Map<String, String> env = env();
    env.put("NATS_URL", "http://localhost:4222");
    assertThrows(IllegalArgumentException.class, () -> StoreConfig.fromEnvironment(env));
  }

  @Test
  void configPathAndKeyAreOptional() {
    StoreConfig none = StoreConfig.fromEnvironment(env());
    assertEquals(LocalConfigFile.DEFAULT_PATH, none.configPath());
    assertTrue(none.sealing().isEmpty());
    assertEquals("STORE_CONFIG_KEY is not set", none.configKeyProblem());

    Map<String, String> env = env();
    String key = CredentialSealingTest.randomKey();
    env.put("STORE_CONFIG_PATH", "/tmp/store/config.json");
    env.put("STORE_CONFIG_KEY", key);
    StoreConfig set = StoreConfig.fromEnvironment(env);
    assertEquals(java.nio.file.Path.of("/tmp/store/config.json"), set.configPath());
    assertTrue(set.sealing().isPresent());
    assertFalse(set.toString().contains(key), "the key is not printed");

    env.put("STORE_CONFIG_KEY", "dG9vIHNob3J0");
    StoreConfig invalid = StoreConfig.fromEnvironment(env);
    assertTrue(invalid.sealing().isEmpty(), "an invalid key is not fatal: degraded");
    assertEquals("STORE_CONFIG_KEY is not 32 bytes", invalid.configKeyProblem());
  }

  @Test
  void passwordAndNatsCredentialsAreNotPrinted() {
    Map<String, String> env = env();
    env.put("NATS_URL", "nats://user:token@nats:4222");
    String text = StoreConfig.fromEnvironment(env).toString();
    assertFalse(text.contains("secret-value"), text);
    assertFalse(text.contains("token"), text);
    assertEquals("nats://***@nats:4222", StoreConfig.redact("nats://user:token@nats:4222"));
  }
}
