package trajectory.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** Unit: the AES-256-GCM sealing of the credentials (proto/README.md > Store config). */
class CredentialSealingTest {
  static String randomKey() {
    byte[] key = new byte[32];
    new SecureRandom().nextBytes(key);
    return Base64.getEncoder().encodeToString(key);
  }

  private static final DbCredentials CREDS = new DbCredentials("writer", "pä\"ss\\word");

  @Test
  void opensWhatItSealsWithTheSameKey() throws Exception {
    var sealing = CredentialSealing.fromBase64(randomKey());
    byte[] sealed = sealing.seal(CREDS);
    assertEquals(CREDS, sealing.open(sealed));
    assertFalse(
        new String(sealed, StandardCharsets.ISO_8859_1).contains("word"), "no plaintext in it");
  }

  @Test
  void opensBytesSealedAsTheSpecSaysByAnotherImplementation() throws Exception {
    // the layout control-web will produce: nonce || ciphertext || tag, AAD trajectory.v1.StoreConfig
    String key = randomKey();
    byte[] nonce = new byte[12];
    new SecureRandom().nextBytes(nonce);
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(
        Cipher.ENCRYPT_MODE,
        new SecretKeySpec(Base64.getDecoder().decode(key), "AES"),
        new GCMParameterSpec(128, nonce));
    c.updateAAD("trajectory.v1.StoreConfig".getBytes(StandardCharsets.UTF_8));
    byte[] ct = c.doFinal("{\"user\": \"u2\", \"password\": \"p2\"}".getBytes(StandardCharsets.UTF_8));
    byte[] sealed = new byte[12 + ct.length];
    System.arraycopy(nonce, 0, sealed, 0, 12);
    System.arraycopy(ct, 0, sealed, 12, ct.length);
    assertEquals(new DbCredentials("u2", "p2"), CredentialSealing.fromBase64(key).open(sealed));
  }

  @Test
  void refusesAnotherKeyTamperedOrShortBytes() {
    byte[] sealed = CredentialSealing.fromBase64(randomKey()).seal(CREDS);
    var other = CredentialSealing.fromBase64(randomKey());
    var e = assertThrows(CredentialSealing.SealingException.class, () -> other.open(sealed));
    assertEquals("cannot decrypt the credentials", e.getMessage());

    var sealing = CredentialSealing.fromBase64(randomKey());
    byte[] good = sealing.seal(CREDS);
    for (int i : new int[] {0, 12, good.length - 1}) {
      byte[] tampered = good.clone();
      tampered[i] ^= 0x01;
      assertThrows(CredentialSealing.SealingException.class, () -> sealing.open(tampered));
    }
    var shortOne =
        assertThrows(CredentialSealing.SealingException.class, () -> sealing.open(new byte[28]));
    assertEquals("sealed credentials too short", shortOne.getMessage());
  }

  @Test
  void theKeyMustBeTheBase64Of32BytesAndIsNeverPrinted() {
    String key = randomKey();
    assertFalse(CredentialSealing.fromBase64(key).toString().contains(key));
    String short16 = Base64.getEncoder().encodeToString(new byte[16]);
    var e =
        assertThrows(IllegalArgumentException.class, () -> CredentialSealing.fromBase64(short16));
    assertEquals("STORE_CONFIG_KEY is not 32 bytes", e.getMessage());
    var notBase64 =
        assertThrows(IllegalArgumentException.class, () -> CredentialSealing.fromBase64("%%%"));
    assertEquals("STORE_CONFIG_KEY is not base64", notBase64.getMessage());
    assertFalse(CREDS.toString().contains("pä"), "the password is not printed");
  }
}
