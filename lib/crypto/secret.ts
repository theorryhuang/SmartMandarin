import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-layer encryption for secrets we store per-user (currently:
 * BYOK Gemini API keys) — AES-256-GCM keyed off a server-only env var, so
 * the value in Postgres is always ciphertext even if the DB were ever
 * exposed. Never import this from a Client Component.
 *
 * SETTINGS_ENCRYPTION_KEY must be 32 raw bytes, base64-encoded — generate
 * with `openssl rand -base64 32`.
 */

function getKey(): Buffer {
  const b64 = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!b64) throw new Error("SETTINGS_ENCRYPTION_KEY not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

/** Returns "base64(iv):base64(authTag):base64(ciphertext)". */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // GCM standard IV size
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const [ivB64, tagB64, ciphertextB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted secret");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
