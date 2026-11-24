package trajectory.store;

import io.nats.client.support.JsonParseException;
import io.nats.client.support.JsonParser;
import io.nats.client.support.JsonValue;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The sealing of the database credentials (proto/README.md &gt; Store config): AES-256-GCM with
 * {@code STORE_CONFIG_KEY}, bytes {@code 12-byte nonce || ciphertext || 16-byte tag}, additional
 * data {@code trajectory.v1.StoreConfig}, plaintext UTF-8 JSON {@code {"user", "password"}}.
 * Never logs nor echoes the key or the plaintext.
 */
public final class CredentialSealing {
  /** The size of the key, in bytes. */
  public static final int KEY_BYTES = 32;
  /** The size of the nonce at the start of the sealed bytes. */
  public static final int NONCE_BYTES = 12;
  /** The size of the GCM tag at the end of the sealed bytes. */
  public static final int TAG_BYTES = 16;
  /** Shorter sealed bytes cannot hold any plaintext: refused before decrypting. */
  public static final int MIN_SEALED_BYTES = NONCE_BYTES + TAG_BYTES + 1;

  private static final byte[] AAD = "trajectory.v1.StoreConfig".getBytes(StandardCharsets.US_ASCII);
  private static final String TRANSFORMATION = "AES/GCM/NoPadding";
  private static final SecureRandom RANDOM = new SecureRandom();

  /** The sealed bytes cannot be opened (wrong key, tampered, not the expected JSON). */
  public static final class SealingException extends Exception {
    private static final long serialVersionUID = 1L;

    SealingException(String message) {
      super(message);
    }
  }

  private final SecretKeySpec key;

  private CredentialSealing(byte[] key) {
    this.key = new SecretKeySpec(key, "AES");
  }

  /**
   * The sealing with the key of {@code STORE_CONFIG_KEY}.
   *
   * @param base64 the base64 of 32 bytes
   * @throws IllegalArgumentException when it is not base64 or not 32 bytes (the value is not in
   *     the message)
   */
  public static CredentialSealing fromBase64(String base64) {
    byte[] raw;
    try {
      raw = Base64.getDecoder().decode(base64.strip());
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("STORE_CONFIG_KEY is not base64");
    }
    if (raw.length != KEY_BYTES) {
      throw new IllegalArgumentException("STORE_CONFIG_KEY is not 32 bytes");
    }
    return new CredentialSealing(raw);
  }

  /** Never prints the key. */
  @Override
  public String toString() {
    return "CredentialSealing[key=***]";
  }

  /**
   * Seals credentials (what control-web does in M4; used by the tests).
   *
   * @param credentials what to seal
   * @return nonce || ciphertext || tag
   */
  public byte[] seal(DbCredentials credentials) {
    Map<String, JsonValue> map = new LinkedHashMap<>();
    map.put("user", new JsonValue(credentials.user()));
    map.put("password", new JsonValue(credentials.password()));
    byte[] plain = new JsonValue(map).toJson().getBytes(StandardCharsets.UTF_8);
    byte[] nonce = new byte[NONCE_BYTES];
    RANDOM.nextBytes(nonce);
    try {
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BYTES * 8, nonce));
      cipher.updateAAD(AAD);
      byte[] sealed = cipher.doFinal(plain); // ciphertext || tag
      byte[] out = new byte[NONCE_BYTES + sealed.length];
      System.arraycopy(nonce, 0, out, 0, NONCE_BYTES);
      System.arraycopy(sealed, 0, out, NONCE_BYTES, sealed.length);
      return out;
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("AES-GCM unavailable", e);
    }
  }

  /**
   * Opens sealed credentials.
   *
   * @param sealed nonce || ciphertext || tag
   * @return the credentials
   * @throws SealingException too short, wrong key, tampered bytes or not {@code {"user",
   *     "password"}}; the message never holds the plaintext
   */
  public DbCredentials open(byte[] sealed) throws SealingException {
    if (sealed.length < MIN_SEALED_BYTES) {
      throw new SealingException("sealed credentials too short");
    }
    byte[] plain;
    try {
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(
          Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BYTES * 8, sealed, 0, NONCE_BYTES));
      cipher.updateAAD(AAD);
      plain = cipher.doFinal(sealed, NONCE_BYTES, sealed.length - NONCE_BYTES);
    } catch (GeneralSecurityException e) {
      throw new SealingException("cannot decrypt the credentials");
    }
    JsonValue json;
    try {
      json = JsonParser.parse(plain);
    } catch (JsonParseException e) {
      throw new SealingException("decrypted credentials are not JSON");
    }
    if (json.type != JsonValue.Type.MAP
        || !isString(json.map.get("user"))
        || !isString(json.map.get("password"))
        || json.map.get("user").string.isEmpty()) {
      throw new SealingException("decrypted credentials are not {\"user\", \"password\"}");
    }
    return new DbCredentials(json.map.get("user").string, json.map.get("password").string);
  }

  private static boolean isString(JsonValue v) {
    return v != null && v.type == JsonValue.Type.STRING;
  }
}
