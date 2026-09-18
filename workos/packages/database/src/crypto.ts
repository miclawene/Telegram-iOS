import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// Server-side Telegram session encryption (ТЗ §5).
// AES-256-GCM. Key comes from SESSION_ENCRYPTION_KEY (32 bytes, base64).
//
// Wire format (base64):  [12-byte IV][16-byte auth tag][ciphertext]

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("SESSION_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptSession(plaintext: string, base64Key: string): string {
  const key = loadKey(base64Key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSession(encoded: string, base64Key: string): string {
  const key = loadKey(base64Key);
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error("Ciphertext too short / malformed");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
