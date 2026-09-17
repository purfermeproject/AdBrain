import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Encrypts OAuth tokens before they're stored in ad_connections
// (docs/03-DATA-MODEL.md §3.2: access_token_encrypted). AES-256-GCM with a
// key derived from META_TOKEN_ENCRYPTION_KEY. Format: "iv:tag:ciphertext",
// each part base64.

function getKey(): Buffer {
  const secret = process.env.META_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY is not configured. Set a long random string in .env.local before connecting a Meta ad account."
    );
  }
  // scrypt derives a fixed 32-byte key from a secret of any length/format,
  // so the env var can be a plain passphrase rather than requiring the
  // operator to generate and paste an exact-length hex/base64 key.
  return scryptSync(secret, "adbrain-token-encryption", 32);
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(encoded: string): string {
  const [ivB64, tagB64, ciphertextB64] = encoded.split(":");
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted token.");
  }
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
