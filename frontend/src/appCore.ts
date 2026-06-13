import type { Message, Model } from "./types";
import { secureFetch } from "./utils/secureFetch";

export const GOOGLE_CLIENT_ID = "17620318358-elb3hcn915ik4f536rfsoo5itup40fdt.apps.googleusercontent.com";

const DEFAULT_RENDER_BACKEND_URL = "https://aura-protocol.onrender.com";

const resolveBackendUrl = (): string => {
  const configured = String(import.meta.env.VITE_BACKEND_URL ?? "").trim();
  if (configured) return configured.replace(/\/$/, "");

  if (typeof window === "undefined") return "http://localhost:8000";

  const { hostname, origin, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:8000";
  if (hostname.endsWith(".vercel.app")) return DEFAULT_RENDER_BACKEND_URL;
  if (protocol === "https:" || protocol === "http:") return origin;
  return DEFAULT_RENDER_BACKEND_URL;
};

export const BACKEND_URL = resolveBackendUrl();

let googleSdkPromise: Promise<void> | null = null;
let accessTokenCache = "";

export const loadGoogleSdk = () => {
  if (window.google) return Promise.resolve();
  if (googleSdkPromise) return googleSdkPromise;
  googleSdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google SDK failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google SDK failed to load"));
    document.head.appendChild(script);
  });
  return googleSdkPromise;
};

export const getAuthHeaders = (): Record<string, string> => {
  return accessTokenCache ? { Authorization: `Bearer ${accessTokenCache}` } : {};
};

export const getSessionSecret = (): string | null => {
  const token = accessTokenCache;
  if (!token) return null;
  try {
    const payloadB64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(payloadB64 || ""));
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
};

export const setClientAccessToken = (token: string): void => {
  accessTokenCache = token;
};

export const clearClientAccessToken = (): void => {
  accessTokenCache = "";
};

export const normalizeApiKey = (value: string): string => {
  const key = value.trim().replace(/^["']|["']$/g, "");
  return key.toLowerCase().startsWith("bearer ") ? key.slice(7).trim() : key;
};

export const AURA_THEME_BG = {
  dark: "#000000",
  light: "#F9F7F2",
};

export const AURA_THEME_OVERLAY = {
  dark: "rgba(0,0,0,0.88)",
  light: "rgba(249,247,242,0.9)",
};

export const hashApiKey = async (apiKey: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const callAI = async (
  model: Model | string,
  messages: Message[],
  overrideSystem: string | null = null,
  userEmail: string = "anonymous",
  sessionId: string = "active_session"
): Promise<string> => {
  const modelId = typeof model === "string" ? model : model.id;
  const effectiveUserId = userEmail || "anonymous";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const body = JSON.stringify({
      model_id: modelId,
      messages,
      user_id: effectiveUserId,
      session_id: sessionId,
      override_system: overrideSystem || "",
    });
    const sessionSecret = getSessionSecret();
    const requestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      } as HeadersInit,
      signal: controller.signal,
      body,
    };
    const res = sessionSecret
      ? await secureFetch(`${BACKEND_URL}/api/chat`, {
          method: "POST",
          headers: requestInit.headers as Record<string, string>,
          body,
          sessionSecret,
          signal: controller.signal,
        })
      : await fetch(`${BACKEND_URL}/api/chat`, requestInit);

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return `[Network Error: ${modelId.toUpperCase()}]\n\nThe backend returned status ${res.status}.\n\nDetails: ${errText}`;
    }

    const data = await res.json();
    return data.text ?? data.response ?? JSON.stringify(data);
  } catch (error: any) {
    clearTimeout(timeoutId);
    const isTimeout =
      error?.name === "AbortError" ||
      String(error?.message || "").toLowerCase().includes("abort");

    if (isTimeout) {
      throw new Error(
        "AURA request timed out after 180 seconds. One or more connected models may be overloaded."
      );
    }

    const msg = error?.message || "Unknown connection error";
    console.warn(`[AURA] callAI failed for ${modelId}:`, msg);
    return `[Connection Error: ${modelId.toUpperCase()}]\n\nFailed to reach the AURA backend.\n\nDetails: ${msg}`;
  }
};

export const INITIAL_MODELS: Model[] = [
  { id: "aura", name: "AURA", provider: "Gemini Supervisor", hex: "#2563EB", tw: "bg-blue-600" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Anthropic ", hex: "#D97706", tw: "bg-amber-600" },
  { id: "gpt4", name: "GPT-4o", provider: "OpenAI Node", hex: "#059669", tw: "bg-emerald-600" },
  { id: "gemini", name: "Gemini", provider: "Google Gemini Node", hex: "#2563EB", tw: "bg-blue-600" },
  { id: "mistral", name: "Mistral Large", provider: "Mistral Network", hex: "#7C3AED", tw: "bg-violet-600" },
  { id: "llama", name: "Llama 3 70B", provider: "Meta P2P Node", hex: "#DC2626", tw: "bg-red-600" },
  { id: "deepseek", name: "DeepSeek V3", provider: "DeepSeek Grid", hex: "#0891B2", tw: "bg-cyan-600" },
  { id: "groq-sonnet-4-6-persona", name: "Claude Sonnet 4.6 Persona", provider: "Groq LPU", hex: "#9333EA", tw: "bg-purple-600" },
  { id: "anthropic/claude-3-5-sonnet", name: "Claude 3.5 Sonnet (OpenRouter)", provider: "OpenRouter", hex: "#D97706", tw: "bg-amber-600" },
  { id: "openai/gpt-4-turbo", name: "GPT-4 Turbo (OpenRouter)", provider: "OpenRouter", hex: "#059669", tw: "bg-emerald-600" },
  { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash (OpenRouter)", provider: "OpenRouter", hex: "#2563EB", tw: "bg-blue-600" },
  { id: "meta-llama/llama-3.1-405b", name: "Llama 3.1 405B (OpenRouter)", provider: "OpenRouter", hex: "#DC2626", tw: "bg-red-600" },
  { id: "black-forest-labs/flux-pro", name: "FLUX Pro (Image Gen)", provider: "OpenRouter", hex: "#F97316", tw: "bg-orange-500" },
  { id: "black-forest-labs/flux-realism", name: "FLUX Realism (Image Gen)", provider: "OpenRouter", hex: "#F59E0B", tw: "bg-amber-500" },
  { id: "openai/dall-e-3", name: "DALL-E 3 (Image Gen)", provider: "OpenRouter", hex: "#06B6D4", tw: "bg-cyan-600" },
  { id: "stability-ai/stable-diffusion-3.5-large", name: "Stable Diffusion 3.5 (Image Gen)", provider: "OpenRouter", hex: "#8B5CF6", tw: "bg-purple-600" },
];

export const MAX_CONNECTED_MODELS = 10;
export const MODEL_LIMIT_ALERT = "Maximum of 10 models allowed in the Council at once to prevent network overload.";

const getPricingNumber = (value: unknown): number => {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isPaidModel = (model: Model): boolean => {
  if (model.isFree === false) return true;
  if (model.provider.toLowerCase().includes("openrouter") && model.isFree !== true && !model.id.includes(":free")) return true;
  if (!model.pricing) return false;
  return getPricingNumber(model.pricing.prompt) > 0 || getPricingNumber(model.pricing.completion) > 0;
};

export const isFreeModel = (model: Model): boolean => {
  if (model.isFree === true) return true;
  const provider = model.provider.toLowerCase();
  return provider.includes("free") || provider.includes("huggingface");
};

export const hasConfiguredAccess = (model: Model): boolean => {
  if (model.nodeAddress?.trim()) return true;
  const provider = model.provider.toLowerCase();
  return provider.includes("gemini") || provider.includes("claude style") || provider.includes("anthropic (persona)") || provider.includes("groq");
};

export const isSpecializedNonChatModel = (model: Model): boolean => {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    name.includes("image") ||
    name.includes("embedding") ||
    name.includes("moderation") ||
    id.includes("flux") ||
    id.includes("dall-e") ||
    id.includes("stable-diffusion") ||
    id.includes("whisper") ||
    id.includes("tts")
  );
};

export const modelAvailabilityRank = (model: Model): number => {
  if (isPaidModel(model)) return 5;
  if (isSpecializedNonChatModel(model)) return 4;
  if (isFreeModel(model)) return 0;
  if (hasConfiguredAccess(model)) return 1;
  if (model.id === "aura" || model.id === "gemini" || model.id === "supervisor") return 1;
  return 2;
};

export const sortModelsByAvailability = (items: Model[]): Model[] =>
  [...items].sort((a, b) => {
    const rankDiff = modelAvailabilityRank(a) - modelAvailabilityRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

export const getDefaultConnectedModels = (items: Model[]): Model[] => {
  const usable = sortModelsByAvailability(items).filter(
    (model) => !isPaidModel(model) && !isSpecializedNonChatModel(model)
  );
  return (usable.length > 0 ? usable : sortModelsByAvailability(items)).slice(0, 6);
};
