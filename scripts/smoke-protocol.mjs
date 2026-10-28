/**
 * Headless protocol smoke: pairing key derive + encrypt/decrypt + unpaired reject.
 * No Electron GUI required (CI / aidlc-fast verify-cmd).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import assert from "node:assert/strict";

function derive(code, salt) {
  return scryptSync(code.normalize("NFKC"), salt, 32);
}

function encrypt(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(blobB64, key) {
  const buf = Buffer.from(blobB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const code = "482913";
const salt = randomBytes(16);
const keyA = derive(code, salt);
const keyB = derive(code, salt);
assert.deepEqual(keyA, keyB);

const cipher = encrypt("hello from Windows", keyA);
assert.equal(decrypt(cipher, keyB), "hello from Windows");

let failed = false;
try {
  decrypt(cipher, derive("000000", salt));
} catch {
  failed = true;
}
assert.equal(failed, true, "wrong code must not decrypt");

console.log("smoke-protocol: OK");
console.log("  pairing derive + AES-GCM roundtrip");
console.log("  unpaired/wrong code rejected");
