import Core from "./Core.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("server/utils/crypto.ts");

/**
 * AES-256-GCM field encryption wrapper (§12.15).
 *
 * Single shared helper for every "encryption at rest" path required by
 * §7.1.1. Every sensitive field uses `encryptField` on write and
 * `decryptField` / `decryptFieldOptional` on read. Only this module
 * calls `crypto.subtle.encrypt` / `crypto.subtle.decrypt` for at-rest
 * data; all other callsites use the exported helpers.
 *
 * Wire format (§12.15): base64(`<iv>:<ciphertext_with_tag>`) — the GCM tag
 * is appended to the ciphertext by Web Crypto (16-byte trailer), so a single
 * decrypt call recovers both halves.
 */

const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: CryptoKey | null = null;
let cachedKeyMaterial: string | null = null;

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64Decode(value: string): Uint8Array {
  const s = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const setting = await Core.getInstance().getSetting("auth.encryption.key");
  if (!setting) {
    throw new Error(
      "auth.encryption.key is not configured — refusing to encrypt or decrypt sensitive data (§12.15).",
    );
  }

  // Cache the derived CryptoKey, but invalidate when the setting value
  // changes so rotations that go through a reload are honored without
  // requiring a process restart.
  if (cachedKey && cachedKeyMaterial === setting) {
    return cachedKey;
  }

  let raw: Uint8Array;
  try {
    raw = b64Decode(setting);
  } catch {
    throw new Error(
      "auth.encryption.key must be valid base64 — refusing to encrypt or decrypt sensitive data (§12.15).",
    );
  }

  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `auth.encryption.key must decode to ${KEY_BYTES} bytes (AES-256), got ${raw.length}.`,
    );
  }

  // Copy into a fresh ArrayBuffer so the TS DOM lib types are satisfied
  // (importKey's BufferSource narrows to ArrayBuffer, not SharedArrayBuffer).
  const rawBuf = new ArrayBuffer(raw.length);
  new Uint8Array(rawBuf).set(raw);
  const key = await crypto.subtle.importKey(
    "raw",
    rawBuf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  cachedKey = key;
  cachedKeyMaterial = setting;
  return key;
}

/**
 * Encrypt a plaintext string. Returns a base64 envelope safe to store in a
 * `TYPE option<string>` SurrealDB column. Uses a fresh 12-byte IV per call.
 */
export async function encryptField(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    data.buffer as ArrayBuffer,
  );
  return `${b64Encode(iv)}:${b64Encode(new Uint8Array(cipherBuf))}`;
}

/**
 * Decrypt a base64 envelope produced by `encryptField`. Throws on tag
 * mismatch (tampering, wrong key, corrupted column) — callers treat the
 * throw as a cryptographic failure, not a missing value.
 */
export async function decryptField(envelope: string): Promise<string> {
  const colon = envelope.indexOf(":");
  if (colon <= 0 || colon === envelope.length - 1) {
    throw new Error("Malformed ciphertext envelope.");
  }
  const iv = b64Decode(envelope.slice(0, colon));
  const ct = b64Decode(envelope.slice(colon + 1));
  if (iv.length !== IV_BYTES) {
    throw new Error("Malformed ciphertext envelope IV.");
  }
  const key = await getKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    ct.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(plain);
}

/**
 * Convenience: returns `undefined` when `envelope` is `undefined | null | ""`,
 * otherwise delegates to `decryptField`. Use at read-path boundaries where
 * the optional column may be absent.
 */
export async function decryptFieldOptional(
  envelope: string | null | undefined,
): Promise<string | undefined> {
  if (!envelope) return undefined;
  return decryptField(envelope);
}
