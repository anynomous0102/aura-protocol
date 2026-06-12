const encoder = new TextEncoder();

export interface SecureFetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  sessionSecret: string;
  signal?: AbortSignal;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(digest);
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await window.crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(signature);
}

export async function secureFetch(url: string, options: SecureFetchOptions): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const body = options.body ?? "";
  const timestamp = Date.now().toString();
  const resolvedUrl = new URL(url, window.location.origin);
  const bodyHash = await sha256Hex(body);
  const signingInput = `${method}:${resolvedUrl.pathname}:${timestamp}:${bodyHash}`;
  const signature = await hmacSha256Hex(options.sessionSecret, signingInput);

  return fetch(url, {
    method,
    body: options.body,
    signal: options.signal,
    headers: {
      ...(options.headers ?? {}),
      "X-AURA-Signature": signature,
      "X-AURA-Timestamp": timestamp,
    },
  });
}
