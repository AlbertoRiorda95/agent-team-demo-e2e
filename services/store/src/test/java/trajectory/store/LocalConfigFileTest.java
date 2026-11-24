package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Unit: the local config file (atomic write, sealed credentials only, corrupt files). */
class LocalConfigFileTest {
  @TempDir Path dir;

  @Test
  void noFileIsEmpty() throws Exception {
    assertEquals(Optional.empty(), new LocalConfigFile(dir.resolve("config.json")).load());
  }

  @Test
  void savesAndLoadsWithTheCredentialsStillSealed() throws Exception {
    var file = new LocalConfigFile(dir.resolve("sub/config.json"));
    var sealing = CredentialSealing.fromBase64(CredentialSealingTest.randomKey());
    byte[] sealed = sealing.seal(new DbCredentials("writer", "file-secret-pw"));
    var content = new LocalConfigFile.Content(7, new TablePrefix("demo_"), sealed);
    file.save(content);
    assertEquals(Optional.of(content), file.load());

    String text = Files.readString(file.path());
    assertTrue(text.contains("\"config_version\":7"), text);
    assertTrue(text.contains("\"table_prefix\":\"demo_\""), text);
    assertFalse(text.contains("file-secret-pw"), "the password is not in clear");
    assertFalse(text.contains("writer"), "nor the user");
    try (var files = Files.list(file.path().getParent())) {
      assertEquals(1, files.count(), "no temporary file left");
    }

    var prefixOnly = new LocalConfigFile.Content(8, TablePrefix.NONE, new byte[0]);
    file.save(prefixOnly);
    assertEquals(Optional.of(prefixOnly), file.load());
    assertFalse(Files.readString(file.path()).contains("db_credentials_sealed"));
  }

  @Test
  void corruptFilesAreRefusedWithoutEchoingTheirContent() throws Exception {
    Path path = dir.resolve("config.json");
    var file = new LocalConfigFile(path);
    for (String bad :
        new String[] {
          "not json secret-content",
          "[]",
          "{\"table_prefix\":\"\"}",
          "{\"config_version\":-1,\"table_prefix\":\"\"}",
          "{\"config_version\":1,\"table_prefix\":\"Bad-Prefix\"}",
          "{\"config_version\":1,\"table_prefix\":\"\",\"db_credentials_sealed\":\"%%%\"}"
        }) {
      Files.writeString(path, bad);
      var e = assertThrows(LocalConfigFile.InvalidFileException.class, file::load, bad);
      assertFalse(e.getMessage().contains("secret-content"));
    }
  }
}
