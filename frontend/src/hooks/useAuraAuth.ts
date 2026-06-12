import { useCallback, useState } from "react";
import { clearClientAccessToken, setClientAccessToken } from "../appCore";
import type { User } from "../types";
import { secureClear, secureRetrieve, secureStore } from "../utils/cryptoStorage";

export const ACCESS_TOKEN_KEY = "access_token";
export const LEGACY_ACCESS_TOKEN_KEY = "aura_access_token";
export const SESSION_CRYPTO_SECRET_KEY = "aura_session_crypto_secret";
export type AuthState = "loading" | "authenticated" | "unauthenticated";

export function ensureSessionCryptoSecret(): string {
  const existing = localStorage.getItem(SESSION_CRYPTO_SECRET_KEY);
  if (existing) return existing;

  const bytes = window.crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  localStorage.setItem(SESSION_CRYPTO_SECRET_KEY, secret);
  return secret;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadB64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!payloadB64) return null;
    return JSON.parse(atob(payloadB64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function sessionSecretFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
}

export function isExpiredToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === "number" && payload.exp * 1000 < Date.now() - 60_000;
}

export async function readStoredAccessToken(): Promise<string> {
  const secret = ensureSessionCryptoSecret();
  let token = await secureRetrieve<string>(ACCESS_TOKEN_KEY, secret);
  const legacyToken = localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY);

  if (!token && legacyToken) {
    token = legacyToken;
    await secureStore(ACCESS_TOKEN_KEY, legacyToken, secret);
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  }

  return token ?? "";
}

export async function persistAccessToken(token: string): Promise<void> {
  await secureStore(ACCESS_TOKEN_KEY, token, ensureSessionCryptoSecret());
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  setClientAccessToken(token);
}

export async function clearAccessToken(): Promise<void> {
  await secureClear(ACCESS_TOKEN_KEY);
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  clearClientAccessToken();
}

export function useAuraAuth() {
  const [user, setUser] = useState<User>({ name: "AURA User", photo: null, isAuthenticated: false });
  const [authToken, setAuthToken] = useState("");
  const [authState, setAuthState] = useState<AuthState>("loading");

  const persistToken = useCallback(async (token: string): Promise<void> => {
    await persistAccessToken(token);
    setAuthToken(token);
  }, []);

  const clearToken = useCallback(async (): Promise<void> => {
    await clearAccessToken();
    setAuthToken("");
    setUser({ name: "AURA User", photo: null, isAuthenticated: false, email: undefined });
    setAuthState("unauthenticated");
  }, []);

  return {
    user,
    setUser,
    authToken,
    setAuthToken,
    authState,
    setAuthState,
    persistToken,
    clearToken,
  };
}
