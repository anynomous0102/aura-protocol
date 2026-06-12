const STORAGE_PREFIX = "aura_enc_";
const PBKDF2_SALT = "aura-v1";
const PBKDF2_ITERATIONS = 100_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveStorageKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function secureStore(key: string, value: unknown, secret: string): Promise<void> {
  const storageKey = await deriveStorageKey(secret);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, storageKey, plaintext),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, bytesToBase64Url(packed));
}

export async function secureRetrieve<T = unknown>(key: string, secret: string): Promise<T | null> {
  const encoded = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  if (!encoded) return null;
  try {
    const packed = base64UrlToBytes(encoded);
    if (packed.length <= 12) throw new Error("Encrypted payload is too short.");
    const iv = packed.slice(0, 12);
    const ciphertext = packed.slice(12);
    const storageKey = await deriveStorageKey(secret);
    const plaintext = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, storageKey, ciphertext);
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    await secureClear(key);
    return null;
  }
}

export async function secureClear(key: string): Promise<void> {
  localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
}

export async function secureClearAll(): Promise<void> {
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((value): value is string => value !== null && value.startsWith(STORAGE_PREFIX));
  keys.forEach((storageKey) => localStorage.removeItem(storageKey));
}

export { deriveStorageKey };

