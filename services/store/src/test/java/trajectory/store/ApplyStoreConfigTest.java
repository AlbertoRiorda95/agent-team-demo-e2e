package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.ByteString;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import trajectory.v1.Config.ConfigSet;
import trajectory.v1.Config.PropagatorConfig;
import trajectory.v1.Config.StoreConfig;

/** Unit: the config use case with fake ports (version rule, validation, credentials, file). */
class ApplyStoreConfigTest {
  private static final DbCredentials ENV = new DbCredentials("env-user", "env-pw");
  private static final DbCredentials NEW = new DbCredentials("new-user", "new-pw");

  private final CredentialSealing sealing =
      CredentialSealing.fromBase64(CredentialSealingTest.randomKey());
  private final List<String> calls = new ArrayList<>();
  private String failing = "";

  private final ApplyStoreConfig.Ports ports =
      new ApplyStoreConfig.Ports() {
        @Override
        public void migrate(TablePrefix prefix, DbCredentials credentials) throws Exception {
          calls.add("migrate " + prefix.value() + " as " + credentials.user());
          if (failing.equals("migrate")) {
            throw new Exception("relation exists\nmore");
          }
        }

        @Override
        public void testConnection(DbCredentials credentials) throws Exception {
          calls.add("test " + credentials.user());
          if (failing.equals("test")) {
            throw new Exception("password authentication failed for user \"new-user\"");
          }
        }

        @Override
        public void save(LocalConfigFile.Content content) throws Exception {
          calls.add("save " + content.version() + " " + content.prefix().value());
          if (failing.equals("save")) {
            throw new Exception("read-only file system");
          }
        }
      };

  private ApplyStoreConfig useCase(Optional<CredentialSealing> key) {
    return new ApplyStoreConfig(ConfigInForce.defaults(ENV), key, ports);
  }

  private static byte[] set(long version, String prefix, byte[] sealed) {
    return ConfigSet.newBuilder()
        .setService("store")
        .setConfigVersion(version)
        .setStore(
            StoreConfig.newBuilder()
                .setTablePrefix(prefix)
                .setDbCredentialsSealed(ByteString.copyFrom(sealed)))
        .build()
        .toByteArray();
  }

  @Test
  void aNewPrefixIsMigratedSavedThenInForce() {
    var uc = useCase(Optional.of(sealing));
    var r = uc.handle(set(1, "demo_", new byte[0]));
    assertTrue(r.ok() && r.changed(), r.error());
    assertEquals(List.of("migrate demo_ as env-user", "save 1 demo_"), calls);
    assertEquals(new ConfigInForce(1, new TablePrefix("demo_"), new byte[0], ENV), uc.inForce());
  }

  @Test
  void versionRuleHigherAppliedEqualAcknowledgedLowerStale() {
    var uc = useCase(Optional.of(sealing));
    assertTrue(uc.handle(set(5, "a_", new byte[0])).ok());
    calls.clear();
    var same = uc.handle(set(5, "b_", new byte[0]));
    assertTrue(same.ok());
    assertFalse(same.changed());
    var stale = uc.handle(set(4, "c_", new byte[0]));
    assertEquals(new ApplyStoreConfig.Result(false, "stale version", false, uc.inForce()), stale);
    assertEquals(List.of(), calls, "nothing touched");
    assertEquals("a_", uc.inForce().prefix().value());
  }

  @Test
  void sealedCredentialsAreTestedThenInForceAndKeptSealed() {
    var uc = useCase(Optional.of(sealing));
    byte[] sealed = sealing.seal(NEW);
    var r = uc.handle(set(2, "", sealed));
    assertTrue(r.ok(), r.error());
    assertEquals(List.of("test new-user", "save 2 "), calls, "no migration: same prefix");
    assertEquals(NEW, uc.inForce().credentials());
    assertArrayEquals(sealed, uc.inForce().sealedCredentials());

    // empty sealed bytes: the credentials in force are kept
    calls.clear();
    assertTrue(uc.handle(set(3, "x_", new byte[0])).ok());
    assertEquals(List.of("migrate x_ as new-user", "save 3 x_"), calls);
    assertEquals(NEW, uc.inForce().credentials());
    assertArrayEquals(sealed, uc.inForce().sealedCredentials());
  }

  @Test
  void aFailedTestConnectionKeepsTheOldCredentials() {
    var uc = useCase(Optional.of(sealing));
    failing = "test";
    var r = uc.handle(set(2, "", sealing.seal(NEW)));
    assertFalse(r.ok());
    assertTrue(r.error().startsWith("cannot connect with the new credentials"), r.error());
    assertFalse(r.error().contains("new-pw"));
    assertEquals(ConfigInForce.defaults(ENV), uc.inForce());
  }

  @Test
  void anotherKeyOrNoKeyIsRefused() {
    var other = CredentialSealing.fromBase64(CredentialSealingTest.randomKey());
    var uc = useCase(Optional.of(sealing));
    var r = uc.handle(set(2, "", other.seal(NEW)));
    assertEquals("cannot decrypt the credentials", r.error());
    assertEquals(List.of(), calls);

    var noKey = useCase(Optional.empty());
    assertEquals("no config key", noKey.handle(set(2, "", other.seal(NEW))).error());
    var prefixOnly = noKey.handle(set(2, "p_", new byte[0]));
    assertTrue(prefixOnly.ok(), "prefix-only sets are applied without a key");
  }

  @Test
  void migrationOrSaveFailuresChangeNothing() {
    var uc = useCase(Optional.of(sealing));
    failing = "migrate";
    var m = uc.handle(set(1, "demo_", new byte[0]));
    assertEquals("cannot migrate the tables of the prefix: relation exists", m.error());
    failing = "save";
    var s = uc.handle(set(1, "demo_", new byte[0]));
    assertEquals("cannot save the local config file: read-only file system", s.error());
    assertEquals(ConfigInForce.defaults(ENV), uc.inForce());
  }

  @Test
  void invalidSetsAreRefused() {
    var uc = useCase(Optional.of(sealing));
    assertEquals(
        "not a trajectory.v1.ConfigSet", uc.handle(new byte[] {(byte) 0xff, 0x01}).error());
    assertEquals(
        "service must be store",
        uc.handle(
                ConfigSet.newBuilder()
                    .setService("propagator")
                    .setConfigVersion(1)
                    .setStore(StoreConfig.getDefaultInstance())
                    .build()
                    .toByteArray())
            .error());
    assertEquals(
        "no store payload",
        uc.handle(
                ConfigSet.newBuilder()
                    .setService("store")
                    .setConfigVersion(1)
                    .setPropagator(PropagatorConfig.getDefaultInstance())
                    .build()
                    .toByteArray())
            .error());
    assertTrue(uc.handle(set(1, "Demo", new byte[0])).error().startsWith("table prefix must"));
    assertTrue(uc.handle(set(1, "a_very_long_prefix_", new byte[0])).error().startsWith("table"));
    assertEquals("sealed credentials too short", uc.handle(set(1, "", new byte[28])).error());
    assertEquals(List.of(), calls);
    assertEquals(0, uc.inForce().version());
  }
}
