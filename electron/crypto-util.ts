import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";

export function deriveKeyFromPairingCode(code: string, salt: Buffer): Buffer {
  return scryptSync(code.normalize("NFKC"), salt, 32);
}

export function encryptPayload(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptPayload(blobB64: string, key: Buffer): string {
  return decryptBytes(blobB64, key).toString("utf8");
}

/** Encrypt raw bytes (file chunks) → base64(iv|tag|ciphertext). */
export function encryptBytes(plain: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptBytes(blobB64: string, key: Buffer): Buffer {
  const buf = Buffer.from(blobB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function generatePairingCode(): string {
  // 6 digits, avoid leading zeros confusion by 100000–999999
  return String(Math.floor(100000 + Math.random() * 900000));
}
