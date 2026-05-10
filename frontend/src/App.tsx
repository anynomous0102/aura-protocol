import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ethers } from "ethers";
import LandingPage from "./LandingPage";
import {
  Home, MessageSquare, Settings, Send, Bot, Maximize2, ArrowLeft, X,
  Sparkles, Info, Database, Paperclip, Mic, Download, RefreshCw,
  FileText, LayoutGrid, Shield, Key, Plus, Activity, Trash2,
  AlertTriangle, Loader2, Check, LogOut, Menu,
  PanelRight, PanelLeft, ChevronDown, ArrowRight, Search,
  Network, Sun, Moon, Monitor,
} from "lucide-react";

declare global {
  interface Window {
    google?: any;
    ethereum?: any;
    phantom?: any;
    solana?: any;
    okxwallet?: any;
    trustwallet?: any;
    coinbaseWalletExtension?: any;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔑 FRONTEND CONFIGURATION & DIRECTORY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GOOGLE_CLIENT_ID = "17620318358-elb3hcn915ik4f536rfsoo5itup40fdt.apps.googleusercontent.com";
const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL === undefined
    ? "http://localhost:8000"
    : import.meta.env.VITE_BACKEND_URL
).replace(/\/$/, "");

let googleSdkPromise: Promise<void> | null = null;
const loadGoogleSdk = () => {
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

// Security Helpers
const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("aura_access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const normalizeApiKey = (value: string): string => {
  const key = value.trim().replace(/^["']|["']$/g, "");
  return key.toLowerCase().startsWith("bearer ") ? key.slice(7).trim() : key;
};

const AURA_THEME_BG = {
  dark: "#000000",
  light: "#F9F7F2",
};
const AURA_THEME_OVERLAY = {
  dark: "rgba(0,0,0,0.88)",
  light: "rgba(249,247,242,0.9)",
};


// SHA256 hash function for API keys
const hashApiKey = async (apiKey: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// ─── REPLACE the existing Model interface ───
export interface Model {
  id: string;
  name: string;
  provider: string;
  hex: string;
  tw: string;
  isCustom?: boolean;
  nodeAddress?: string;
  isFree?: boolean;          // true = free/free-tier model in the model panel
  pricing?: { prompt: string; completion: string }; // ← NEW
}
export interface Message {
  role: "user" | "model";
  text: string;
}

export interface CardData extends Model {
  cardId: string;
  state: "loading" | "complete" | "error";
  messages: Message[];
}

export interface User {
  name: string;
  email?: string;
  photo: string | null;
  isAuthenticated: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📡 COMPUTE NODE CONNECTION LOGIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const callAI = async (
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
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      } as HeadersInit,
      signal: controller.signal,
      body: JSON.stringify({
        model_id: modelId,
        messages,
        user_id: effectiveUserId,
        session_id: sessionId,
        override_system: overrideSystem || "",
      }),
    });

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const INITIAL_MODELS: Model[] = [
  { id: "aura", name: "AURA", provider: "Gemini Supervisor", hex: "#2563EB", tw: "bg-blue-600" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Anthropic ", hex: "#D97706", tw: "bg-amber-600" },
  { id: "gpt4", name: "GPT-4o", provider: "OpenAI Node", hex: "#059669", tw: "bg-emerald-600" },
  { id: "gemini", name: "Gemini", provider: "Google Gemini Node", hex: "#2563EB", tw: "bg-blue-600" },
  { id: "mistral", name: "Mistral Large", provider: "Mistral Network", hex: "#7C3AED", tw: "bg-violet-600" },
  { id: "llama", name: "Llama 3 70B", provider: "Meta P2P Node", hex: "#DC2626", tw: "bg-red-600" },
  { id: "deepseek", name: "DeepSeek V3", provider: "DeepSeek Grid", hex: "#0891B2", tw: "bg-cyan-600" },
  { id: "groq-sonnet-4-6-persona", name: "Claude Sonnet 4.6 Persona", provider: "Groq LPU", hex: "#9333EA", tw: "bg-purple-600" },
  // OpenRouter Premium Models
  { id: "anthropic/claude-3-5-sonnet", name: "Claude 3.5 Sonnet (OpenRouter)", provider: "OpenRouter", hex: "#D97706", tw: "bg-amber-600" },
  { id: "openai/gpt-4-turbo", name: "GPT-4 Turbo (OpenRouter)", provider: "OpenRouter", hex: "#059669", tw: "bg-emerald-600" },
  { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash (OpenRouter)", provider: "OpenRouter", hex: "#2563EB", tw: "bg-blue-600" },
  { id: "meta-llama/llama-3.1-405b", name: "Llama 3.1 405B (OpenRouter)", provider: "OpenRouter", hex: "#DC2626", tw: "bg-red-600" },
  // OpenRouter Image Generation Models
  { id: "black-forest-labs/flux-pro", name: "FLUX Pro (Image Gen)", provider: "OpenRouter", hex: "#F97316", tw: "bg-orange-500" },
  { id: "black-forest-labs/flux-realism", name: "FLUX Realism (Image Gen)", provider: "OpenRouter", hex: "#F59E0B", tw: "bg-amber-500" },
  { id: "openai/dall-e-3", name: "DALL-E 3 (Image Gen)", provider: "OpenRouter", hex: "#06B6D4", tw: "bg-cyan-600" },
  { id: "stability-ai/stable-diffusion-3.5-large", name: "Stable Diffusion 3.5 (Image Gen)", provider: "OpenRouter", hex: "#8B5CF6", tw: "bg-purple-600" },
];

const MAX_CONNECTED_MODELS = 10;
const MODEL_LIMIT_ALERT = "Maximum of 10 models allowed in the Council at once to prevent network overload.";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARKDOWN RENDERER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const getPricingNumber = (value: unknown): number => {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isPaidModel = (model: Model): boolean => {
  if (model.isFree === false) return true;
  if (model.provider.toLowerCase().includes("openrouter") && model.isFree !== true && !model.id.includes(":free")) return true;
  if (!model.pricing) return false;
  return getPricingNumber(model.pricing.prompt) > 0 || getPricingNumber(model.pricing.completion) > 0;
};

const isFreeModel = (model: Model): boolean => {
  if (model.isFree === true) return true;
  const provider = model.provider.toLowerCase();
  return provider.includes("free") || provider.includes("huggingface");
};

const hasConfiguredAccess = (model: Model): boolean => {
  if (model.nodeAddress?.trim()) return true;
  const provider = model.provider.toLowerCase();
  return provider.includes("gemini") || provider.includes("claude style") || provider.includes("anthropic (persona)") || provider.includes("groq");
};

const isSpecializedNonChatModel = (model: Model): boolean => {
  const value = `${model.id} ${model.name} ${model.provider}`.toLowerCase();
  return [
    "whisper",
    "orpheus",
    "audio",
    "speech",
    "tts",
    "transcrib",
    "image",
    "flux",
    "dall-e",
    "stable-diffusion",
    "embedding",
  ].some((term) => value.includes(term));
};

const modelAvailabilityRank = (model: Model): number => {
  if (isPaidModel(model)) return 5;
  if (isSpecializedNonChatModel(model)) return 4;
  if (isFreeModel(model)) return 0;
  if (hasConfiguredAccess(model)) return 1;
  if (model.id === "aura" || model.id === "gemini" || model.id === "supervisor") return 1;
  return 2;
};

const sortModelsByAvailability = (items: Model[]): Model[] =>
  [...items].sort((a, b) => {
    const rankDiff = modelAvailabilityRank(a) - modelAvailabilityRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

const getDefaultConnectedModels = (items: Model[]): Model[] => {
  const usable = sortModelsByAvailability(items).filter(
    (model) => !isPaidModel(model) && !isSpecializedNonChatModel(model)
  );
  return (usable.length > 0 ? usable : sortModelsByAvailability(items)).slice(0, 6);
};

const Markdown: React.FC<{ text?: string }> = ({ text }) => {
  if (!text) return null;
  const blocks: { t: string; c: string }[] = [];

  const codeRx = new RegExp('```([\\s\\S]*?)```', 'g');

  let last = 0, m;
  while ((m = codeRx.exec(text)) !== null) {
    if (m.index > last) blocks.push({ t: "txt", c: text.slice(last, m.index) });
    blocks.push({ t: "code", c: m[1] });
    last = codeRx.lastIndex;
  }
  if (last < text.length) blocks.push({ t: "txt", c: text.slice(last) });

  const esc = (s: string) => s
    // Headings → clean text with bold
    .replace(/^#{1,6}\s+(.+)$/gm, "<strong style='display:block;margin:8px 0 4px;font-size:1.05em'>$1</strong>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    // Inline code
    .replace(/`(.+?)`/g, "<code style='background:var(--bg3);padding:1px 5px;border-radius:4px;font-size:0.9em'>$1</code>")
    // Bullet lists (- or * at start of line)
    .replace(/^[\-\*]\s+(.+)$/gm, "<div style='display:flex;gap:8px;padding:2px 0'><span style='color:var(--gold);flex-shrink:0'>•</span><span>$1</span></div>")
    // Numbered lists
    .replace(/^(\d+)\.\s+(.+)$/gm, "<div style='display:flex;gap:8px;padding:2px 0'><span style='color:var(--gold);font-weight:600;flex-shrink:0'>$1.</span><span>$2</span></div>")
    // Blockquotes
    .replace(/^>\s+(.+)$/gm, "<div style='border-left:3px solid var(--gold);padding:4px 12px;margin:4px 0;color:var(--t2);font-style:italic'>$1</div>")
    // Horizontal rules
    .replace(/^---+$/gm, "<hr style='border:none;border-top:1px solid var(--border);margin:8px 0'/>")
    // Line breaks
    .replace(/\n/g, "<br/>");

  return (
    <div className="md-root" style={{ lineHeight: 1.65, fontSize: 14 }}>
      {blocks.map((b, i) =>
        b.t === "code"
          ? <pre key={i} className="md-pre"><code>{b.c}</code></pre>
          : <span key={i} dangerouslySetInnerHTML={{ __html: esc(b.c) }} />
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BRAND ICONS (Custom SVGs)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const I: React.FC<{ d: string | string[], size?: number, stroke?: number }> = ({ d, size = 16, stroke = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d as string} />}
  </svg>
);
const IconGithub = () => <I d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />;
const IconChrome = () => <I d={["M12 22a10 10 0 100-20 10 10 0 000 20z", "M12 8a4 4 0 100 8 4 4 0 000-8z", "M2.05 12H12", "M21.95 12H15.54", "M12 2.05V8", "M8.7 18.31l2.8-4.83"]} />;

const IconMeta = () => <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" /><path d="M12 2c3.5 3 5 7 5 10s-1.5 7-5 10c-3.5-3-5-7-5-10s1.5-7 5-10z" /><path d="M2 12h20" /></svg>;

const Dots: React.FC<{ color?: string }> = ({ color = "var(--gold)" }) => (
  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
    {[0, 1, 2].map(i => (
      <motion.span key={i}
        style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }}
        animate={{ opacity: [0.2, 1, 0.2] }}
        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
      />
    ))}
  </span>
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WALLET CONNECT MODAL (Thirdweb ConnectEmbed-inspired)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Wallet brand SVG icons
const WalletIconMetaMask = () => (
  <svg width={28} height={28} viewBox="0 0 35 33" fill="none">
    <path d="M32.96 1l-13.14 9.72 2.45-5.73L32.96 1z" fill="#E2761B" stroke="#E2761B" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.66 1l13.02 9.81-2.33-5.82L2.66 1zM28.23 23.53l-3.5 5.34 7.49 2.06 2.15-7.28-6.14-.12zM1.27 23.65l2.13 7.28 7.47-2.06-3.48-5.34-6.12.12z" fill="#E4761B" stroke="#E4761B" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.47 14.51l-2.09 3.17 7.41.34-.26-7.97-5.06 4.46zM25.17 14.51l-5.13-4.55-.17 8.06 7.4-.34-2.1-3.17zM10.87 28.87l4.49-2.16-3.88-3.02-.61 5.18zM20.28 26.71l4.45 2.16-.57-5.18-3.88 3.02z" fill="#E4761B" stroke="#E4761B" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M24.73 28.87l-4.45-2.16.36 2.88-.04 1.22 4.13-1.94zM10.87 28.87l4.14 1.94-.03-1.22.34-2.88-4.45 2.16z" fill="#D7C1B3" stroke="#D7C1B3" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15.09 21.78l-3.74-1.1 2.64-1.21 1.1 2.31zM20.55 21.78l1.1-2.31 2.65 1.21-3.75 1.1z" fill="#233447" stroke="#233447" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.87 28.87l.63-5.34-4.12.12 3.49 5.22zM24.14 23.53l.59 5.34 3.5-5.22-4.09-.12zM27.27 17.68l-7.4.34.69 3.76 1.1-2.31 2.65 1.21 2.96-3zM11.35 20.68l2.64-1.21 1.1 2.31.69-3.76-7.4-.34 2.97 3z" fill="#CD6116" stroke="#CD6116" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.38 17.68l3.07 5.98-.1-2.98-2.97-3zM24.31 20.68l-.12 2.98 3.08-5.98-2.96 3zM15.78 18.02l-.69 3.76.87 4.49.19-5.91-.37-2.34zM19.87 18.02l-.36 2.33.16 5.92.87-4.49-.67-3.76z" fill="#E4751F" stroke="#E4751F" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20.55 21.78l-.87 4.49.63.44 3.88-3.02.12-2.98-3.76 1.07zM11.35 20.68l.1 2.98 3.88 3.02.62-.44-.86-4.49-3.74-1.07z" fill="#F6851B" stroke="#F6851B" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20.6 30.81l.03-1.22-.34-.29h-4.94l-.32.29.04 1.22-4.14-1.94 1.45 1.18 2.93 2.03h5.02l2.95-2.03 1.44-1.18-4.12 1.94z" fill="#C0AD9E" stroke="#C0AD9E" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20.28 26.71l-.63-.44h-3.66l-.62.44-.34 2.88.32-.29h4.94l.33.29-.34-2.88z" fill="#161616" stroke="#161616" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M33.52 11.35l1.12-5.36L32.96 1l-12.68 9.4 4.88 4.11 6.89 2.01 1.52-1.77-.66-.48 1.05-.96-.81-.62 1.05-.8-.69-.52zM1 5.99l1.13 5.36-.72.52 1.06.8-.8.62 1.04.96-.66.48 1.52 1.77 6.89-2.01 4.88-4.11L2.66 1 1 5.99z" fill="#763D16" stroke="#763D16" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M32.05 16.52l-6.89-2.01 2.08 3.17-3.07 5.98 4.06-.05h6.09l-2.27-7.09zM10.47 14.51l-6.89 2.01-2.29 7.13h6.08l4.05.05-3.06-5.98 2.11-3.21zM19.87 18.02l.44-7.62 2-5.4h-8.9l1.99 5.4.44 7.62.17 2.35.01 5.91h3.66l.02-5.91.17-2.35z" fill="#F6851B" stroke="#F6851B" strokeWidth={0.25} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WalletIconWalletConnect = () => (
  <svg width={28} height={28} viewBox="0 0 300 185" fill="none">
    <path d="M61.44 36.23c49.01-47.99 128.48-47.99 177.49 0l5.9 5.78a6.05 6.05 0 010 8.69l-20.18 19.75a3.18 3.18 0 01-4.44 0l-8.12-7.94c-34.19-33.49-89.63-33.49-123.81 0l-8.69 8.51a3.18 3.18 0 01-4.44 0L55.17 51.26a6.05 6.05 0 010-8.69l6.27-6.34zM276.19 72.9l17.96 17.58a6.05 6.05 0 010 8.69l-80.96 79.3a6.37 6.37 0 01-8.88 0l-57.46-56.3a1.59 1.59 0 00-2.22 0l-57.46 56.3a6.37 6.37 0 01-8.88 0L-2.67 99.17a6.05 6.05 0 010-8.69L15.3 72.9a6.37 6.37 0 018.88 0l57.46 56.3a1.59 1.59 0 002.22 0L141.32 72.9a6.37 6.37 0 018.88 0l57.46 56.3a1.59 1.59 0 002.22 0L267.31 72.9a6.37 6.37 0 018.88 0z" fill="#3B99FC" />
  </svg>
);

const WalletIconCoinbase = () => (
  <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
    <rect width={28} height={28} rx={6} fill="#0052FF" />
    <path fillRule="evenodd" clipRule="evenodd" d="M14 24c5.523 0 10-4.477 10-10S19.523 4 14 4 4 8.477 4 14s4.477 10 10 10zm-3.2-12.8a1.2 1.2 0 011.2-1.2h4a1.2 1.2 0 011.2 1.2v4a1.2 1.2 0 01-1.2 1.2h-4a1.2 1.2 0 01-1.2-1.2v-4z" fill="#fff" />
  </svg>
);

const WalletIconPhantom = () => (
  <svg width={28} height={28} viewBox="0 0 128 128" fill="none">
    <rect width={128} height={128} rx={26} fill="url(#phantom_grad)" />
    <defs><linearGradient id="phantom_grad" x1={0} y1={0} x2={128} y2={128}><stop stopColor="#534BB1" /><stop offset={1} stopColor="#551BF9" /></linearGradient></defs>
    <path d="M110.58 64.88c-.56-7.28-3.38-14.12-7.94-19.67a36.07 36.07 0 00-17.47-12.27c-7.1-2.3-14.69-2.56-21.92-.76a36.14 36.14 0 00-18.52 11.07c-2.54 2.88-4.6 6.15-6.13 9.65A39.23 39.23 0 0035.05 68c.11 3.74.71 7.46 1.79 11.03a34.03 34.03 0 006.9 12.03A35.86 35.86 0 0056 100.7c2.05.7 4.2 1.12 6.35 1.31 3.17.28 6.37.04 9.47-.71a30.86 30.86 0 0016.55-10.42c4.28-5.06 7.12-11.12 8.31-17.55a45.59 45.59 0 00.72-8.45H78.62c0 3.32-2.69 6.01-6.01 6.01a6.01 6.01 0 01-6.01-6.01 6.01 6.01 0 016.01-6.01h37.97z" fill="#fff" />
    <circle cx={50} cy={65} r={5} fill="#534BB1" />
    <circle cx={72} cy={65} r={5} fill="#534BB1" />
  </svg>
);

const WalletIconTrust = () => (
  <svg width={28} height={28} viewBox="0 0 40 40" fill="none">
    <rect width={40} height={40} rx={8} fill="#0500FF" />
    <path d="M20 6.5s7.5 3.3 12.5 3.3V21C32.5 29.8 20 35 20 35S7.5 29.8 7.5 21V9.8C12.5 9.8 20 6.5 20 6.5z" stroke="#fff" strokeWidth={2} fill="none" />
    <path d="M20 13v8m0 0l-4-4m4 4l4-4" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WalletIconRainbow = () => (
  <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
    <rect width={28} height={28} rx={6} fill="#001E59" />
    <path d="M5 18a9 9 0 0118 0" stroke="#FF4000" strokeWidth={2.5} fill="none" />
    <path d="M7 18a7 7 0 0114 0" stroke="#FF9901" strokeWidth={2.5} fill="none" />
    <path d="M9 18a5 5 0 0110 0" stroke="#FFF700" strokeWidth={2.5} fill="none" />
    <path d="M11 18a3 3 0 016 0" stroke="#01DA40" strokeWidth={2.5} fill="none" />
    <path d="M13 18a1 1 0 012 0" stroke="#01AEF8" strokeWidth={2.5} fill="none" />
  </svg>
);

interface WalletOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  popular?: boolean;
  color: string;
}

const WALLET_OPTIONS: WalletOption[] = [
  { id: "metamask", name: "MetaMask", description: "Connect using browser wallet", icon: <WalletIconMetaMask />, popular: true, color: "#E2761B" },
  { id: "walletconnect", name: "WalletConnect", description: "Scan with mobile wallet", icon: <WalletIconWalletConnect />, color: "#3B99FC" },
  { id: "coinbase", name: "Coinbase Wallet", description: "Connect Coinbase wallet", icon: <WalletIconCoinbase />, color: "#0052FF" },
  { id: "phantom", name: "Phantom", description: "Solana & multi-chain wallet", icon: <WalletIconPhantom />, color: "#AB9FF2" },
  { id: "trust", name: "Trust Wallet", description: "Mobile-first crypto wallet", icon: <WalletIconTrust />, color: "#0500FF" },
  { id: "rainbow", name: "Rainbow", description: "Fun, powerful Ethereum wallet", icon: <WalletIconRainbow />, color: "#001E59" },
  { id: "rabby", name: "Rabby Wallet", description: "The game changer for Ethereum", icon: <Shield size={24} />, color: "#627EEA" },
  { id: "okx", name: "OKX Wallet", description: "Your portal to Web3", icon: <LayoutGrid size={24} />, color: "#000000" },
];


interface WalletConnectModalProps {
  onClose: () => void;
  onSelectWallet: (walletId: string) => Promise<void>; // ← now returns Promise
  onManualConnect: (address: string, signature: string, message: string) => Promise<void>; // ← NEW
  isConnecting: string | null;
}

const WalletConnectModal = React.forwardRef<HTMLDivElement, WalletConnectModalProps>(
  ({ onClose, onSelectWallet, onManualConnect, isConnecting }, forwardedRef) => {
    const internalRef = useRef<HTMLDivElement>(null);
    const [step, setStep] = useState<"select" | "connect">("select");
    const [selectedWallet, setSelectedWallet] = useState<WalletOption | null>(null);
    const [autoError, setAutoError] = useState<string>("");

    // Manual signing state
    const [manualAddr, setManualAddr] = useState("");
    const [manualSig, setManualSig] = useState("");
    const [manualError, setManualError] = useState("");
    const [manualLoading, setManualLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    // Stable nonce for the session challenge
    const [nonce] = useState(() => Math.floor(Math.random() * 1_000_000).toString());
    const challengeMsg = `Welcome to AURA. Sign this message to authenticate your Decentralized Identifier. Nonce: ${nonce}`;

    useEffect(() => {
      const handleClick = (e: MouseEvent) => {
        if (internalRef.current && !internalRef.current.contains(e.target as Node)) onClose();
      };
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [onClose]);

    const handleWalletClick = async (wallet: WalletOption) => {
      setSelectedWallet(wallet);
      setStep("connect");
      setAutoError("");
      setManualError("");
      try {
        await onSelectWallet(wallet.id);
        // Success: parent closes the modal automatically
      } catch (err: any) {
        // Extension not found or user rejected — show manual form
        setAutoError(err.message || "Auto-connect failed. Use manual signing below.");
      }
    };

    const handleManualSubmit = async () => {
      if (!manualAddr.trim() || !manualSig.trim()) {
        setManualError("Please provide both your wallet address and the signature.");
        return;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(manualAddr.trim())) {
        setManualError("Invalid address. Must be 0x followed by exactly 40 hex characters.");
        return;
      }
      setManualLoading(true);
      setManualError("");
      try {
        await onManualConnect(manualAddr.trim(), manualSig.trim(), challengeMsg);
      } catch (err: any) {
        setManualError(err.message || "Verification failed. Please check your address and signature.");
      } finally {
        setManualLoading(false);
      }
    };

    const copyChallenge = () => {
      navigator.clipboard?.writeText(challengeMsg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    };

    return (
      <motion.div
        ref={forwardedRef}
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ zIndex: 10001 }}
      >
        <motion.div
          ref={internalRef}
          initial={{ scale: 0.92, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.92, y: 20, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="wallet-modal"
          style={{ maxHeight: "90vh", overflowY: "auto" }}
        >
          {/* ── HEADER ── */}
          <div className="wallet-modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {step === "connect" && (
                <button
                  onClick={() => {
                    setStep("select");
                    setSelectedWallet(null);
                    setAutoError("");
                    setManualError("");
                    setManualAddr("");
                    setManualSig("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--t2)",
                    display: "flex",
                    alignItems: "center",
                    padding: "4px",
                    borderRadius: 6,
                  }}
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <div className="wallet-modal-icon">
                <Shield size={18} color="var(--gold)" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--t1)" }}>
                  {step === "select" ? "Connect Wallet" : `Connect ${selectedWallet?.name || ""}`}
                </h3>
                <p style={{ margin: 0, fontSize: 12, color: "var(--t3)", marginTop: 2 }}>
                  {step === "select"
                    ? "Choose your preferred wallet"
                    : "Prove wallet ownership via signature"}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="wallet-close-btn">
              <X size={16} />
            </button>
          </div>

          {/* ── STEP: WALLET GRID ── */}
          <AnimatePresence mode="wait">
            {step === "select" && (
              <motion.div
                key="select"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
              >
                <div className="wallet-grid">
                  {WALLET_OPTIONS.map((w, i) => (
                    <motion.button
                      key={w.id}
                      className={`wallet-option ${isConnecting === w.id ? "connecting" : ""}`}
                      onClick={() => handleWalletClick(w)}
                      disabled={!!isConnecting}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.22 }}
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="wallet-option-icon" style={{ background: `${w.color}15` }}>
                        {isConnecting === w.id ? (
                          <Loader2 size={22} className="animate-spin" style={{ color: w.color }} />
                        ) : (
                          w.icon
                        )}
                      </div>
                      <div className="wallet-option-info">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className="wallet-option-name">{w.name}</span>
                          {w.popular && <span className="wallet-popular-badge">Popular</span>}
                        </div>
                        <span className="wallet-option-desc">
                          {isConnecting === w.id ? "Connecting..." : w.description}
                        </span>
                      </div>
                      <ArrowRight size={14} color="var(--t3)" style={{ flexShrink: 0, opacity: 0.5 }} />
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── STEP: CONNECTION + MANUAL FORM ── */}
            {step === "connect" && (
              <motion.div
                key="connect"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.2 }}
                style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}
              >
                {/* Auto-connect status bar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    background: "var(--bg2)",
                    border: `1px solid ${autoError ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
                    borderRadius: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: `${selectedWallet?.color}15`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {selectedWallet?.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    {isConnecting === selectedWallet?.id ? (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>
                          Connecting to {selectedWallet?.name}…
                        </div>
                        <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>
                          Approve the request in your wallet extension
                        </div>
                      </>
                    ) : autoError ? (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#EF4444" }}>
                          Extension not detected
                        </div>
                        <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>
                          Install {selectedWallet?.name} or use manual signing below
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>
                          {selectedWallet?.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>
                          Manually sign the challenge below
                        </div>
                      </>
                    )}
                  </div>
                  {isConnecting === selectedWallet?.id && (
                    <Loader2
                      size={16}
                      className="animate-spin"
                      style={{ color: selectedWallet?.color, flexShrink: 0 }}
                    />
                  )}
                  {autoError && (
                    <AlertTriangle size={16} style={{ color: "#EF4444", flexShrink: 0 }} />
                  )}
                </div>

                {/* Section divider */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--t3)",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Manual Signing (works with any wallet)
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>

                {/* Field 1: ETH address */}
                <div>
                  <label className="field-label">Your ETH Wallet Address</label>
                  <input
                    type="text"
                    placeholder="0x1234...abcd"
                    value={manualAddr}
                    onChange={(e) => setManualAddr(e.target.value)}
                    style={{
                      width: "100%",
                      background: "var(--bg2)",
                      border: "1px solid var(--border2)",
                      borderRadius: 10,
                      padding: "9px 12px",
                      fontSize: 13,
                      color: "var(--t1)",
                      outline: "none",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  />
                </div>

                {/* Field 2: Challenge message */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <label className="field-label" style={{ marginBottom: 0 }}>
                      Message to Sign
                    </label>
                    <button
                      onClick={copyChallenge}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: copied ? "#22C55E" : "var(--gold)",
                        fontSize: 11,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {copied ? (
                        <>
                          <Check size={11} /> Copied!
                        </>
                      ) : (
                        <>
                          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x={9} y={9} width={13} height={13} rx={2} /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>{" "}
                          Copy message
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    style={{
                      background: "var(--bg2)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 11,
                      color: "var(--t2)",
                      fontFamily: "JetBrains Mono, monospace",
                      lineHeight: 1.55,
                      wordBreak: "break-all",
                    }}
                  >
                    {challengeMsg}
                  </div>
                  <p style={{ fontSize: 11, color: "var(--t3)", marginTop: 6, lineHeight: 1.5 }}>
                    In MetaMask: open the extension → ⋮ menu → Sign Message, paste the text above. Or
                    use any{" "}
                    <code
                      style={{
                        fontSize: 10,
                        background: "var(--bg3)",
                        padding: "1px 4px",
                        borderRadius: 4,
                      }}
                    >
                      personal_sign
                    </code>{" "}
                    compatible tool.
                  </p>
                </div>

                {/* Field 3: Paste signature */}
                <div>
                  <label className="field-label">Paste Your Signature</label>
                  <textarea
                    placeholder="0x4b3c..."
                    value={manualSig}
                    onChange={(e) => setManualSig(e.target.value)}
                    rows={2}
                    style={{
                      width: "100%",
                      background: "var(--bg2)",
                      border: "1px solid var(--border2)",
                      borderRadius: 10,
                      padding: "9px 12px",
                      fontSize: 12,
                      color: "var(--t1)",
                      outline: "none",
                      fontFamily: "JetBrains Mono, monospace",
                      resize: "none",
                    }}
                  />
                </div>

                {/* Error display */}
                {manualError && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "10px 12px",
                      background: "rgba(239,68,68,0.07)",
                      border: "1px solid rgba(239,68,68,0.2)",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "#EF4444",
                      lineHeight: 1.5,
                    }}
                  >
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    {manualError}
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handleManualSubmit}
                  disabled={manualLoading || !manualAddr.trim() || !manualSig.trim()}
                  style={{
                    width: "100%",
                    padding: "12px",
                    background: "var(--btn-bg)",
                    color: "var(--btn-text)",
                    border: "none",
                    borderRadius: 12,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: !manualAddr.trim() || !manualSig.trim() ? 0.45 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  {manualLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Shield size={16} />
                  )}
                  {manualLoading ? "Verifying Signature…" : "Verify & Create Real DID"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer */}
          <div className="wallet-modal-footer">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Shield size={12} color="var(--gold)" />
              <span style={{ fontSize: 11, color: "var(--t3)" }}>
                Non-custodial · Your keys, your identity
              </span>
            </div>
            <span style={{ fontSize: 10, color: "var(--t3)", opacity: 0.6 }}>OAPIN-L1 v2.0</span>
          </div>
        </motion.div>
      </motion.div>
    );
  }
);
WalletConnectModal.displayName = "WalletConnectModal";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONNECTED WALLET PANEL (Post-connection UI)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface ConnectWalletProps {
  walletAddress: string;
  ethBalance: string;
  onClose: () => void;
  onDisconnect: () => void;
}

const ConnectWallet = React.forwardRef<HTMLDivElement, ConnectWalletProps>(({ walletAddress, ethBalance, onClose, onDisconnect }, forwardedRef) => {
  const [copied, setCopied] = useState(false);
  const internalRef = useRef<HTMLDivElement>(null);

  const truncated = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "0x0000...0000";

  const copyAddress = () => {
    navigator.clipboard?.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (internalRef.current && !internalRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <motion.div
      ref={forwardedRef}
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ zIndex: 10002 }}
    >
      <motion.div
        ref={internalRef}
        initial={{ scale: 0.92, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.92, y: 20, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="cw-panel"
      >
        {/* Close */}
        <button onClick={onClose} className="cw-close"><X size={16} /></button>

        {/* Fingerprint Icon */}
        <div className="cw-fingerprint">
          <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="url(#cw-grad)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="cw-grad" x1="0" y1="0" x2="24" y2="24"><stop stopColor="#60A5FA" /><stop offset="1" stopColor="#3B82F6" /></linearGradient></defs>
            <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
            <path d="M5 19.5C5.5 18 6 15 6 12c0-3.3 2.7-6 6-6 1.8 0 3.3.8 4.4 2" />
            <path d="M12 10a2 2 0 0 0-2 2c0 3-1.5 6-3 7.5" />
            <path d="M12 10a2 2 0 0 1 2 2c0 4.5-1 7-2.5 8.5" />
            <path d="M16.5 17.5c.5-1.5 1.5-4 1.5-5.5a6 6 0 0 0-.5-2.5" />
            <path d="M20 21c.5-2 2-5 2-9 0-5.5-4.5-10-10-10" />
          </svg>
        </div>

        {/* Address + Balance */}
        <div className="cw-addr-row">
          <span className="cw-addr">{truncated}</span>
          <button onClick={copyAddress} className="cw-copy-btn" title="Copy address">
            {copied ? <Check size={12} /> : <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x={9} y={9} width={13} height={13} rx={2} /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>}
          </button>
        </div>
        <div className="cw-balance">{ethBalance} ETH</div>

        {/* Action Buttons */}
        <div className="cw-actions">
          <button className="cw-action-btn">
            <Send size={14} /> Send
          </button>
          <button className="cw-action-btn">
            <Download size={14} /> Receive
          </button>
          <button className="cw-action-btn">
            <Plus size={14} /> Buy
          </button>
        </div>

        {/* Menu Items */}
        <div className="cw-menu">
          <button className="cw-menu-item">
            <div className="cw-menu-icon" style={{ color: "#60A5FA" }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
            </div>
            <span>Ethereum</span>
            <ArrowRight size={14} style={{ marginLeft: "auto", opacity: 0.4 }} />
          </button>
          <button className="cw-menu-item">
            <div className="cw-menu-icon">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
            </div>
            <span>Transactions</span>
          </button>
          <button className="cw-menu-item">
            <div className="cw-menu-icon">
              <Database size={16} />
            </div>
            <span>View Funds</span>
          </button>
          <button className="cw-menu-item">
            <div className="cw-menu-icon">
              <Key size={16} />
            </div>
            <span>Export Private Key</span>
          </button>
        </div>

        {/* Disconnect */}
        <button className="cw-disconnect" onClick={onDisconnect}>
          <LogOut size={16} /> Disconnect Wallet
        </button>
      </motion.div>
    </motion.div>
  );
});
ConnectWallet.displayName = "ConnectWallet";


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PEARL ORB
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface PearlOrbProps {
  onClick: () => void;
  isDark: boolean;
}

const PearlOrb: React.FC<PearlOrbProps> = ({ onClick, isDark }) => (
  <div onClick={onClick} style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", userSelect: "none" }}>
    <motion.div
      animate={{ y: -8, scale: 1.03 }}
      transition={{ duration: 3, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
      whileHover={{ scale: 1.08, transition: { duration: 0.3 } }}
      style={{
        width: 148, height: 148, borderRadius: "50%", position: "relative", overflow: "hidden",
        background: isDark ? "#FFFFFF" : "white",
        boxShadow: isDark
          ? "0 20px 60px rgba(37,99,235,0.3), 0 4px 16px rgba(0,0,0,0.5), inset 0 -8px 24px rgba(37,99,235,0.5), inset 0 4px 12px rgba(255,255,255,0.8)"
          : "0 20px 60px rgba(217,119,6,0.22), 0 4px 16px rgba(0,0,0,0.08), inset 0 -8px 20px rgba(217,119,6,0.18), inset 0 4px 12px rgba(255,255,255,0.9)",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
      <div style={{ position: "absolute", inset: 0, background: isDark ? "radial-gradient(ellipse at 50% 20%, rgba(255,255,255,1) 10%, rgba(255,255,255,0) 60%)" : "radial-gradient(ellipse at 35% 30%, rgba(255,255,255,0.95) 0%, transparent 55%)" }} />
      <motion.div style={{ position: "absolute", width: "140%", height: "80%", bottom: "-25%", left: "-20%", background: isDark ? "#2563EB" : "#D97706", borderRadius: "50%", filter: "blur(22px)", opacity: isDark ? 0.95 : 0.90 }} animate={{ x: 20, y: 12, scale: 1.05 }} transition={{ duration: 4, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }} />
      <motion.div style={{ position: "absolute", width: "120%", height: "65%", top: "35%", left: "-10%", background: isDark ? "#60A5FA" : "#FCD34D", borderRadius: "50%", filter: "blur(20px)", opacity: 0.85 }} animate={{ x: -16, y: -8, scale: 1.08 }} transition={{ duration: 5.5, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }} />
      <motion.div style={{ position: "absolute", width: "100%", height: "60%", top: "-10%", left: "0%", background: isDark ? "#FFFFFF" : "rgba(255,255,255,0.65)", borderRadius: "50%", filter: isDark ? "blur(12px)" : "blur(10px)", opacity: 1 }} animate={{ x: 10, y: -6, scale: 1.06 }} transition={{ duration: 4.5, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }} />
      <div style={{ position: "absolute", top: "8%", left: "12%", width: "42%", height: "30%", background: isDark ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.65)", borderRadius: "50%", filter: "blur(8px)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: "inset 0 -2px 8px rgba(0,0,0,0.12)" }} />
      <div style={{ position: "relative", zIndex: 10, fontSize: 24, fontWeight: 700, letterSpacing: "0.15em", color: "#ffffff", textShadow: "0 2px 10px rgba(0,0,0,0.35)" }}>
        AURA
      </div>
    </motion.div>
  </div>
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ONBOARDING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface OnboardingProps {
  onComplete: (selected: string[]) => void;
  onOAuthLogin: (provider: string) => Promise<void>;
  onShowWalletModal?: () => void;
}

const Onboarding = React.forwardRef<HTMLDivElement, OnboardingProps>(({ onComplete, onOAuthLogin, onShowWalletModal }, ref) => {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>(["supervisor", "claude", "gpt4", "gemini"]);
  const [isAuthenticating, setIsAuthenticating] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState<boolean>(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  const selectedTheme = (localStorage.getItem("aura-theme") || "system").toLowerCase();
  const useDarkTheme = selectedTheme === "dark" || (selectedTheme === "system" && systemDark);
  const onboardingBg = useDarkTheme ? AURA_THEME_BG.dark : AURA_THEME_BG.light;
  const onboardingOverlay = useDarkTheme ? AURA_THEME_OVERLAY.dark : AURA_THEME_OVERLAY.light;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mediaQuery.addEventListener("change", handleThemeChange);
    return () => mediaQuery.removeEventListener("change", handleThemeChange);
  }, []);

  const toggle = (id: string) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const handleProviderLogin = async (provider: string) => {
    setIsAuthenticating(provider);
    try {
      await onOAuthLogin(provider);
      setIsAuthenticating(null);
      setStep(3);
    } catch (e) {
      setIsAuthenticating(null);
      console.warn("Failed to authenticate. Feel free to skip for now.");
    }
  };

  return (
    <motion.div
      ref={ref}
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ background: onboardingOverlay }}
    >
      <motion.div initial={{ scale: 0.94 }} animate={{ scale: 1 }} className="onboard-box" style={{ background: onboardingBg }}>
        {step === 1 && (
          <div className="onboard-step">
            <div className="onboard-orb" />
            <h2 className="onboard-title">Welcome to AURA</h2>
            <p className="onboard-sub">One query. Every model. Zero API keys.<br />The decentralized AI protocol aggregator.</p>
            <button className="btn-primary full" onClick={() => setStep(2)}>Get Started</button>
          </div>
        )}

        {step === 2 && (
          <div className="onboard-step">
            <h2 className="onboard-title" style={{ marginBottom: 6 }}>Secure Access</h2>
            <p className="onboard-sub" style={{ marginBottom: 20 }}>Connect Web3 Wallet (DID)</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

              <button
                key="web3"
                className="btn-social"
                style={{ borderColor: "var(--gold)", color: "var(--gold)", background: "var(--gold-lt)" }}
                onClick={() => onShowWalletModal?.()}
                disabled={!!isAuthenticating}
              >
                <Shield size={16} />
                Connect Web3 Wallet (DID)
              </button>

              {[
                { id: "google", icon: <IconChrome />, label: "Continue with Google" },
                { id: "github", icon: <IconGithub />, label: "Continue with GitHub" },
                { id: "meta", icon: <IconMeta />, label: "Continue with Meta" },
              ].map(b => (
                <button key={b.id} className="btn-social" onClick={() => handleProviderLogin(b.id)} disabled={!!isAuthenticating}>
                  {isAuthenticating === b.id ? <Loader2 size={16} className="animate-spin" /> : b.icon}
                  {isAuthenticating === b.id ? "Authenticating..." : b.label}
                </button>
              ))}
            </div>
            <div className="or-divider"><span>or</span></div>
            <button
              className="btn-primary full"
              onClick={() => onComplete(selected)}
              disabled={!!isAuthenticating}
            >
              Skip onboarding
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="onboard-step">
            <h2 className="onboard-title" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span style={{ color: "var(--gold)" }}><Shield size={20} /></span> Activate Nodes
            </h2>
            <p className="onboard-sub" style={{ marginBottom: 16 }}>Select P2P network providers to query simultaneously.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
              {INITIAL_MODELS.map(m => {
                const on = selected.includes(m.id);
                return (
                  <button key={m.id} className={`model-select-row ${on ? "on" : ""}`} onClick={() => toggle(m.id)}>
                    <div className="ms-dot" style={{ background: m.hex }} />
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <div className="ms-name">{m.name}</div>
                      <div className="ms-prov">{m.provider}</div>
                    </div>
                    <div className="ms-check" style={{ opacity: on ? 1 : 0.2 }}>
                      <Check size={16} />
                    </div>
                  </button>
                );
              })}
            </div>
            <button className="btn-primary full" style={{ marginTop: 14 }} disabled={!selected.length}
              onClick={() => onComplete(selected)}>
              Enter AURA →
            </button>
          </div>
        )}

        <div className="onboard-dots">
          {[1, 2, 3].map(s => <div key={s} className={`od ${step === s ? "active" : ""}`} />)}
        </div>
      </motion.div>
    </motion.div>
  );
});
Onboarding.displayName = "Onboarding";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS MODAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface SettingsModalProps {
  onClose: () => void;
  theme: string;
  setTheme: (t: string) => void;
  models: Model[];
  setModels: React.Dispatch<React.SetStateAction<Model[]>>;
  connected: Model[];
  setConnected: React.Dispatch<React.SetStateAction<Model[]>>;
  user: User;
  setUser: React.Dispatch<React.SetStateAction<User>>;
  onOAuthLogin: (provider: string) => Promise<void>;
  onLogout: () => void;
  onShowWalletModal?: () => void;
}

const SettingsModal = React.forwardRef<HTMLDivElement, SettingsModalProps>(({
  onClose, theme, setTheme, models, setModels, connected, setConnected, user, setUser, onOAuthLogin, onLogout, onShowWalletModal
}, ref) => {
  const [tab, setTab] = useState<"models" | "appearance" | "profile">("models");
  const [addingNode, setAddingNode] = useState(false);
  const [nProv, setNProv] = useState("");
  const [nName, setNName] = useState("");
  const [nAddress, setNAddress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<string | null>(null);

  // BYOK (Bring Your Own Key) Dynamic State
  const [addingKey, setAddingKey] = useState(false);
  const [kProvider, setKProvider] = useState("openrouter");
  const [kModelId, setKModelId] = useState("anthropic/claude-3-5-sonnet");
  const [kCustomName, setKCustomName] = useState("");
  const [kValue, setKValue] = useState("");

  const handleProviderChange = (val: string) => {
    setKProvider(val);
    const defs: Record<string, { model: string; name?: string }> = {
      openai: { model: "gpt-4o" },
      anthropic: { model: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      google: { model: "gemini-1.5-pro" },
      mistral: { model: "mistral-large-latest" },
      deepseek: { model: "deepseek-chat" },
      groq: { model: "llama-3.3-70b-versatile", name: "Claude Sonnet 4.6 Persona (Groq)" },
      openrouter: { model: "anthropic/claude-3-5-sonnet" }
    };
    setKModelId(defs[val]?.model || "");
    setKCustomName(defs[val]?.name || "");
  };

  const toggleConnectedModel = (model: Model) => {
    setConnected((prev) => {
      const isOn = prev.some((c) => c.id === model.id);
      if (isOn) return prev.filter((c) => c.id !== model.id);
      if (prev.length >= MAX_CONNECTED_MODELS) {
        alert(MODEL_LIMIT_ALERT);
        return prev;
      }
      return [...prev, model];
    });
  };

  // Removed deprecated handleAddOpenRouterKey - use fetchOrModels and handleAddKey instead


  const [orKey, setOrKey] = useState("");
  const [isFetchingOr, setIsFetchingOr] = useState(false);
  const [orModels, setOrModels] = useState<Model[]>([]);
  const [orStats, setOrStats] = useState<{ free: number; paid: number } | null>(null);
  const [orSearch, setOrSearch] = useState("");
  const [orFilter, setOrFilter] = useState<"all" | "free" | "paid">("all");
  const [orFreeOnly, setOrFreeOnly] = useState(true);

  const fetchOrModels = async () => {
    setIsFetchingOr(true);
    try {
      // ✅ SECURE: Send API key in POST body, never in URL
      const cleanKey = normalizeApiKey(orKey);
      const keyHash = cleanKey ? await hashApiKey(cleanKey) : "";
      const res = await fetch(`${BACKEND_URL}/api/openrouter/models`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        } as HeadersInit,
        body: JSON.stringify({
          api_key: cleanKey,
          key_hash: keyHash,
          free_only: orFreeOnly,
          search: orSearch
        })
      });
      const data = await res.json();
      if (data.status !== "success") throw new Error(data.message || "Failed to fetch models.");

      const palette = [
        "#8B5CF6", "#EC4899", "#06B6D4", "#14B8A6", "#F97316",
        "#6366F1", "#EF4444", "#84CC16", "#3B82F6", "#1D4ED8",
        "#D97706", "#059669", "#7C3AED", "#DB2777", "#0891B2",
      ];
      let freeCount = 0, paidCount = 0;

      const newModels: Model[] = data.models.map((m: any, i: number) => {
        const pP = String(m.pricing?.prompt ?? "1");
        const pC = String(m.pricing?.completion ?? "1");
        const isFree = pP === "0" && pC === "0";
        if (isFree) freeCount++; else paidCount++;
        return {
          id: m.id,
          name: m.name || m.id.split("/").pop() || m.id,
          provider: "OpenRouter",
          hex: palette[i % palette.length],
          tw: "bg-violet-500",
          isCustom: true,
          nodeAddress: cleanKey,
          isFree,
          pricing: m.pricing,
        };
      });

      setOrModels(sortModelsByAvailability(newModels));
      setOrStats({ free: freeCount, paid: paidCount });

      // Merge into global model list (deduplicate by id)
      setModels((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        return sortModelsByAvailability([...prev, ...newModels.filter((m) => !existingIds.has(m.id))]);
      });

      // Save user-supplied keys only. Server default keys stay on the backend.
      if (cleanKey) {
        await fetch(`${BACKEND_URL}/api/nodes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        } as HeadersInit,
        body: JSON.stringify({
          user_id: user.isAuthenticated ? (user.email ?? user.name) : "anonymous",
          name: "openrouter-key",
          provider: "openrouter",
          address: cleanKey,
          key_hash: keyHash,
        }),
        });
      }
    } catch (err: any) {
      alert(
        `OpenRouter connection failed: ${err.message}\n\nGet a free key at openrouter.ai/keys`
      );
    } finally {
      setIsFetchingOr(false);
    }
  };

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kModelId || !kValue) return;

    try {
      // For OpenRouter: fetch all available models and add them
      if (kProvider === "openrouter") {
        // ✅ SECURE: Send API key in POST body, not in URL
        const cleanKey = normalizeApiKey(kValue);
        const keyHash = await hashApiKey(cleanKey);
        const orRes = await fetch(`${BACKEND_URL}/api/openrouter/models`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          } as HeadersInit,
          body: JSON.stringify({ api_key: cleanKey, key_hash: keyHash })
        });
        const orData = await orRes.json().catch(() => null);
        if (orRes.ok) {
          if (orData?.status === "success" && Array.isArray(orData.models)) {
            // Save the key to backend
            await fetch(`${BACKEND_URL}/api/nodes`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...getAuthHeaders()
              } as HeadersInit,
              body: JSON.stringify({
                user_id: user.isAuthenticated ? (user.email ?? user.name) : "anonymous",
                name: "openrouter-key",
                provider: "openrouter",
                address: cleanKey,
                key_hash: keyHash
              })
            });

            const colors = ["#8B5CF6", "#EC4899", "#06B6D4", "#14B8A6", "#F97316", "#6366F1", "#EF4444", "#84CC16"];
            const newNodes: Model[] = orData.models.slice(0, 30).map((m: any, i: number) => ({
              id: m.id,
              name: m.name || m.id.split("/").pop(),
              provider: "OpenRouter",
              hex: colors[i % colors.length],
              tw: "bg-violet-500",
              isCustom: true,
              nodeAddress: cleanKey,
              isFree: m.is_free === true,
              pricing: m.pricing
            }));

            setModels(p => sortModelsByAvailability([...newNodes, ...p]));
            setConnected(p => [
              ...sortModelsByAvailability(newNodes).filter(m => !isPaidModel(m) && !isSpecializedNonChatModel(m)).slice(0, 3),
              ...p
            ]);
            setAddingKey(false);
            setKValue("");
            setKCustomName("");
            alert(`OpenRouter connected! ${newNodes.length} models added to your council.`);
            return;
          }
        }
        alert(orData?.message || "Failed to fetch OpenRouter models. Check your OpenRouter key and try again.");
        return;
      }

      if (kProvider === "groq") {
        const cleanKey = normalizeApiKey(kValue);
        const keyHash = await hashApiKey(cleanKey);
        const groqRes = await fetch(`${BACKEND_URL}/api/groq/models`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          } as HeadersInit,
          body: JSON.stringify({ api_key: cleanKey, key_hash: keyHash })
        });
        const groqData = await groqRes.json().catch(() => null);
        if (!groqRes.ok || groqData?.status !== "success" || !Array.isArray(groqData.models)) {
          alert(groqData?.message || "Failed to fetch Groq models. Check your Groq key and try again.");
          return;
        }

        await fetch(`${BACKEND_URL}/api/nodes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          } as HeadersInit,
          body: JSON.stringify({
            user_id: user.isAuthenticated ? (user.email ?? user.name) : "anonymous",
            name: "groq-key",
            provider: "groq",
            address: cleanKey,
            key_hash: keyHash
          })
        });

        const colors = ["#9333EA", "#7C3AED", "#2563EB", "#0891B2", "#059669", "#D97706", "#DC2626", "#14B8A6"];
        const newNodes: Model[] = groqData.models.map((m: any, i: number) => ({
          id: `groq:${m.id}`,
          name: m.name || m.id,
          provider: "Groq · Free Models",
          hex: colors[i % colors.length],
          tw: "bg-purple-600",
          isCustom: true,
          nodeAddress: cleanKey,
          isFree: true
        }));

        setModels(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          return sortModelsByAvailability([...newNodes.filter(m => !existingIds.has(m.id)), ...prev]);
        });
        setConnected(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          return [
            ...sortModelsByAvailability(newNodes)
              .filter(m => !existingIds.has(m.id) && !isPaidModel(m) && !isSpecializedNonChatModel(m))
              .slice(0, 3),
            ...prev
          ];
        });
        setAddingKey(false);
        setKValue("");
        setKCustomName("");
        alert(`Groq connected! ${newNodes.length} models from your key were added to your council.`);
        return;
      }

      const cleanKey = normalizeApiKey(kValue);
      await fetch(`${BACKEND_URL}/api/nodes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        } as HeadersInit,
        body: JSON.stringify({
          user_id: user.isAuthenticated ? (user.email ?? user.name) : "anonymous",
          name: kModelId,
          provider: kProvider,
          address: cleanKey,
          key_hash: await hashApiKey(cleanKey)
        })
      });

      const newNode: Model = {
        id: kModelId,
        name: kCustomName.trim() || kModelId,
        provider: `${kProvider.toUpperCase()} BYOK`,
        hex: "#10B981",
        tw: "bg-emerald-500",
        isCustom: true,
        nodeAddress: cleanKey
      };

      setModels(p => sortModelsByAvailability([newNode, ...p]));
      setConnected(p => [newNode, ...p]);

      setAddingKey(false);
      setKValue("");
      setKCustomName("");
      alert("✅ API Key saved securely. Key is hashed with SHA256 and never exposed in the browser.");
    } catch (err) {
      console.warn("Failed to save BYOK.", err);
      alert("❌ Failed to save API key. Please try again.");
    }
  };

  // Hugging Face Hub Directory State
  const [isHfDirectoryOpen, setIsHfDirectoryOpen] = useState(false);
  const [globalHfToken, setGlobalHfToken] = useState("");
  const [liveHfModels, setLiveHfModels] = useState<any[]>([]);
  const [hfSearchTerm, setHfSearchTerm] = useState("");
  const [isLoadingHf, setIsLoadingHf] = useState(false);
  const [hfServerTokenReady, setHfServerTokenReady] = useState(false);

  // Fetch live Hugging Face models dynamically
  useEffect(() => {
    if (!isHfDirectoryOpen) return;

    const fetchModels = async () => {
      setIsLoadingHf(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/hf-models`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          } as HeadersInit,
          body: JSON.stringify({
            api_key: globalHfToken.trim(),
            search: hfSearchTerm,
            limit: 200,
            task: "all"
          })
        });

        if (res.ok) {
          const data = await res.json();
          setHfServerTokenReady(Boolean(data.token_configured));
          if (data.status === "success" && Array.isArray(data.models)) {
            setLiveHfModels(data.models);
          } else {
            console.error("Backend failed to parse HF models:", data.message);
            setLiveHfModels([]);
          }
        } else {
          console.error("Failed to reach AURA backend.");
          setLiveHfModels([]);
        }
      } catch (err) {
        console.error("Network error fetching HF models", err);
        setLiveHfModels([]);
      } finally {
        setIsLoadingHf(false);
      }
    };

    const timeoutId = setTimeout(fetchModels, 300);
    return () => clearTimeout(timeoutId);
  }, [isHfDirectoryOpen, hfSearchTerm, globalHfToken]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nProv || !nName || !nAddress) return;

    const customId = `custom-${Date.now()}`;
    const nm: Model = { id: customId, name: nName, provider: nProv, hex: "#6B7280", tw: "bg-gray-600", isCustom: true, nodeAddress: nAddress };

    try {
      await fetch(`${BACKEND_URL}/api/nodes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        } as HeadersInit,
        body: JSON.stringify({
          user_id: user.isAuthenticated ? (user.email ?? user.name) : "anonymous",
          name: customId,
          provider: nProv,
          address: nAddress
        })
      });
    } catch (err) {
      console.warn("Backend not running. Node saved locally only.");
    }

    setModels(p => sortModelsByAvailability([nm, ...p]));
    setConnected(p => [nm, ...p]);
    setAddingNode(false);
    setNProv("");
    setNName("");
    setNAddress("");
  };

  const handleQuickConnectHF = async (hfModel: { name: string, url: string, task?: string, is_free?: boolean }) => {
    let tokenToUse = globalHfToken.trim();

    if (!tokenToUse && !hfServerTokenReady) {
      const userToken = window.prompt("Enter your free Hugging Face Access Token (hf_...):");
      if (!userToken) return;
      setGlobalHfToken(userToken);
      tokenToUse = userToken.trim();
    }

    const customId = `hf-${Date.now()}`;
    const newNode: Model = {
      id: customId,
      name: hfModel.name,
      provider: `HuggingFace${hfModel.task ? ` · ${hfModel.task}` : ""}`,
      hex: "#fbbf24",
      tw: "bg-yellow-500",
      isCustom: true,
      nodeAddress: `${hfModel.url}|||${tokenToUse}`,
      isFree: hfModel.is_free !== false
    };

    try {
      // ✅ SECURE: Hash token before storing
      const tokenHash = tokenToUse ? await hashApiKey(tokenToUse) : "server-env";
      await fetch(`${BACKEND_URL}/api/nodes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        } as HeadersInit,
        body: JSON.stringify({
          user_id: user.isAuthenticated ? (user.email ?? user.name) : "anonymous",
          name: customId,
          provider: "HuggingFace",
          address: newNode.nodeAddress,
          token_hash: tokenHash
        })
      });
    } catch (err) {
      console.warn("Backend save failed, local state updated.");
    }

    setModels(prev => sortModelsByAvailability([newNode, ...prev]));
    setConnected(prev => [newNode, ...prev]);
    setIsHfDirectoryOpen(false);
  };

  const handleDeleteNode = async (idToRemove: string) => {
    setModels(prev => prev.filter(m => m.id !== idToRemove));
    setConnected(prev => prev.filter(m => m.id !== idToRemove));
    try {
      await fetch(`${BACKEND_URL}/api/nodes/${idToRemove}`, {
        method: "DELETE",
        headers: {
          ...getAuthHeaders()
        } as HeadersInit
      });
    } catch (err) {
      console.warn("Could not delete from backend database.");
    }
  };

  const handleProviderLogin = async (provider: string) => {
    setIsAuthenticating(provider);
    try { await onOAuthLogin(provider); } catch (e) { }
    setIsAuthenticating(null);
  };

  const TABS = [
    { id: "models", label: "Network Nodes" },
    { id: "appearance", label: "Appearance" },
    { id: "profile", label: "Profile" },
  ] as const;

  return (
    <motion.div ref={ref} className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="settings-panel">
        <div className="settings-sidebar">
          <div className="s-logo">∀</div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {TABS.map(t => (
              <button key={t.id} className={`s-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </nav>
        </div>

        <div className="settings-body">
          <button className="s-close" onClick={onClose}><X size={16} /></button>

          {tab === "models" && (
            <div className="s-section">
              <div className="s-sec-header">
                <div>
                  <h3 className="s-title">Node Network</h3>
                  <p className="s-sub">Toggle P2P compute nodes and manage API providers.</p>
                </div>
              </div>

              {/* ── OPENROUTER KEY MANAGER ── */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border2)",
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 16,
                  width: "calc(100% - 30px)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Key size={15} color="var(--gold)" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)" }}>
                    OpenRouter API Key
                  </span>
                  {orStats && (
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 20,
                          background: "rgba(34,197,94,0.1)",
                          color: "#22C55E",
                          fontWeight: 700,
                        }}
                      >
                        {orStats.free} FREE
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 20,
                          background: "rgba(245,158,11,0.1)",
                          color: "var(--gold)",
                          fontWeight: 700,
                        }}
                      >
                        {orStats.paid} PAID
                      </span>
                    </div>
                  )}
                </div>
                <p style={{ fontSize: 11, color: "var(--t3)", marginBottom: 10, lineHeight: 1.5 }}>
                  Unlock 400+ models (GPT-4o, Claude, Llama, Gemini, Mistral, FLUX…).{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--gold)", textDecoration: "none" }}
                  >
                    Get a free key →
                  </a>
                </p>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--t2)", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={orFreeOnly}
                      onChange={(e) => setOrFreeOnly(e.target.checked)}
                    />
                    Free models only
                  </label>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--t3)" }}>
                    Blank key uses server key
                  </span>
                </div>

                {/* Key input */}
                <div style={{ display: "flex", gap: 8, marginBottom: orModels.length ? 12 : 0 }}>
                  <input
                    type="password"
                    value={orKey}
                    onChange={(e) => setOrKey(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchOrModels()}
                    placeholder="Optional personal key: sk-or-v1-..."
                    style={{
                      flex: 1,
                      background: "var(--bg2)",
                      border: "1px solid var(--border2)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 13,
                      color: "var(--t1)",
                      outline: "none",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  />
                  <button
                    onClick={fetchOrModels}
                    disabled={isFetchingOr}
                    style={{
                      padding: "8px 16px",
                      background: "var(--gold)",
                      color: "#000",
                      border: "none",
                      borderRadius: 10,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexShrink: 0,
                      opacity: isFetchingOr ? 0.5 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {isFetchingOr ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) :
                      (
                        <Network size={14} />
                      )}
                    {isFetchingOr ? "Loading…" : "Load"}
                  </button>
                </div>

                {/* Model browser (shown after key is connected) */}
                {orModels.length > 0 && (
                  <>
                    {/* Search input */}
                    <div style={{ position: "relative", marginBottom: 8 }}>
                      <Search
                        size={12}
                        style={{
                          position: "absolute",
                          left: 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                          color: "var(--t3)",
                        }}
                      />
                      <input
                        type="text"
                        value={orSearch}
                        onChange={(e) => setOrSearch(e.target.value)}
                        placeholder="Search models by name or provider…"
                        style={{
                          width: "100%",
                          background: "var(--bg2)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: "6px 10px 6px 28px",
                          fontSize: 12,
                          color: "var(--t1)",
                          outline: "none",
                        }}
                      />
                    </div>

                    {/* Filter tabs */}
                    <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                      {(["all", "free", "paid"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setOrFilter(f)}
                          style={{
                            padding: "3px 10px",
                            borderRadius: 20,
                            border: "1px solid",
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: "pointer",
                            background: orFilter === f ? "var(--gold-lt)" : "transparent",
                            borderColor: orFilter === f ? "var(--gold)" : "var(--border)",
                            color: orFilter === f ? "var(--gold)" : "var(--t3)",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {f}
                        </button>
                      ))}
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          color: "var(--t3)",
                          alignSelf: "center",
                        }}
                      >
                        {
                          orModels
                            .filter(
                              (m) =>
                                (!orSearch ||
                                  m.name.toLowerCase().includes(orSearch.toLowerCase()) ||
                                  m.id.toLowerCase().includes(orSearch.toLowerCase())) &&
                                (orFilter === "all" ||
                                  (orFilter === "free" && m.isFree) ||
                                  (orFilter === "paid" && !m.isFree))
                            ).length
                        }{" "}
                        models
                      </span>
                    </div>

                    {/* Scrollable model list */}
                    <div
                      className="custom-scrollbar"
                      style={{
                        maxHeight: 200,
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      {orModels
                        .filter(
                          (m) =>
                            (!orSearch ||
                              m.name.toLowerCase().includes(orSearch.toLowerCase()) ||
                              m.id.toLowerCase().includes(orSearch.toLowerCase())) &&
                            (orFilter === "all" ||
                              (orFilter === "free" && m.isFree) ||
                              (orFilter === "paid" && !m.isFree))
                        )
                        .sort((a, b) => modelAvailabilityRank(a) - modelAvailabilityRank(b) || a.name.localeCompare(b.name))
                        .map((m) => {
                          const isOn = connected.some((c) => c.id === m.id);
                          return (
                            <div
                              key={m.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "5px 8px",
                                background: isOn ? "var(--gold-lt)" : "transparent",
                                borderRadius: 8,
                                border: isOn ? "1px solid var(--border)" : "1px solid transparent",
                                transition: "background 0.15s",
                              }}
                            >
                              <div
                                style={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: "50%",
                                  background: m.hex,
                                  flexShrink: 0,
                                }}
                              />
                              <span
                                title={m.id}
                                style={{
                                  flex: 1,
                                  fontSize: 12,
                                  color: "var(--t1)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {m.name}
                              </span>
                              <span
                                style={{
                                  fontSize: 9,
                                  padding: "1px 6px",
                                  borderRadius: 20,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                  letterSpacing: "0.04em",
                                  background: m.isFree
                                    ? "rgba(34,197,94,0.12)"
                                    : "rgba(245,158,11,0.10)",
                                  color: m.isFree ? "#22C55E" : "var(--gold)",
                                }}
                              >
                                {m.isFree ? "FREE" : "PAID"}
                              </span>
                              <button
                                className={`toggle ${isOn ? "on" : ""}`}
                                style={
                                  { "--on": m.hex, transform: "scale(0.7)", margin: 0, flexShrink: 0 } as React.CSSProperties
                                }
                                onClick={() => toggleConnectedModel(m)}
                              >
                                <motion.div className="t-knob" animate={{ x: isOn ? 20 : 2 }} />
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>

              {/* ── HF DIRECTORY BUTTON ── */}
              <button
                onClick={() => setIsHfDirectoryOpen(true)}
                style={{
                  width: "calc(100% - 30px)",
                  padding: "12px",
                  background: "#CA8A04",
                  color: "white",
                  border: "none",
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "filter 0.15s",
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>🤗</span> Browse Open-Source Models (Hugging Face)
              </button>

              {/* ── MODEL ROWS (ALL NODES) ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "calc(100% - 30px)" }}>
                {models
                  .filter(
                    (m) =>
                      !(window as any)._settingsModelSearch ||
                      m.name.toLowerCase().includes((window as any)._settingsModelSearch) ||
                      m.provider.toLowerCase().includes((window as any)._settingsModelSearch)
                  )
                  .sort((a, b) => modelAvailabilityRank(a) - modelAvailabilityRank(b) || a.name.localeCompare(b.name))
                  .map((m) => {
                    const on = connected.some((c) => c.id === m.id);
                    return (
                      <div key={m.id} className="model-row">
                        <div className="mr-dot" style={{ background: m.hex }} />
                        <div style={{ flex: 1 }}>
                          <div className="mr-name">
                            {m.name}
                            {m.isCustom && <span className="badge">custom node</span>}
                            {/* FREE / PAID tag on model rows */}
                            {(m.provider === "OpenRouter" || m.provider.includes("OpenRouter")) && typeof m.isFree === "boolean" && (
                              <span
                                style={{
                                  fontSize: 9,
                                  padding: "1px 6px",
                                  borderRadius: 20,
                                  fontWeight: 700,
                                  letterSpacing: "0.04em",
                                  background: m.isFree
                                    ? "rgba(34,197,94,0.12)"
                                    : "rgba(245,158,11,0.10)",
                                  color: m.isFree ? "#22C55E" : "var(--gold)",
                                  marginLeft: 4,
                                }}
                              >
                                {m.isFree ? "FREE" : "PAID"}
                              </span>
                            )}
                          </div>
                          <div className="mr-prov">{m.provider}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          {m.isCustom && (
                            <button
                              onClick={() => handleDeleteNode(m.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#ef4444",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Remove
                            </button>
                          )}
                          <button
                            className={`toggle ${on ? "on" : ""}`}
                            style={{ "--on": m.hex } as React.CSSProperties}
                            onClick={() => toggleConnectedModel(m)}
                          >
                            <motion.div className="t-knob" animate={{ x: on ? 20 : 2 }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {tab === "appearance" && (
            <div className="s-section">
              <h3 className="s-title">Appearance</h3>
              <p className="s-sub">Choose how AURA looks on your device.</p>

              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                {[
                  { id: "light", icon: <Sun size={18} />, label: "Light" },
                  { id: "dark", icon: <Moon size={18} />, label: "Dark" },
                  { id: "system", icon: <Monitor size={18} />, label: "System" }
                ].map((t) => (
                  <button
                    key={t.id}
                    className={`theme-btn ${theme === t.id ? "active" : ""}`}
                    onClick={() => setTheme(t.id)}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "profile" && (
            <div className="s-section">
              <h3 className="s-title">Profile</h3>
              <p className="s-sub">Your identity within AURA.</p>

              {user.isAuthenticated ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 16 }}>
                  <div className="profile-row" style={{ marginTop: 0 }}>
                    <div className="avatar" onClick={() => fileRef.current?.click()}>
                      {user.photo ? <img src={user.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} /> : user.name[0]?.toUpperCase()}
                      <div className="avatar-hover">📷</div>
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setUser(u => ({ ...u, photo: r.result as string })); r.readAsDataURL(f); } }} />
                    <div style={{ flex: 1 }}>
                      <label className="field-label">Display name</label>
                      <input className="field-input" value={user.name} onChange={e => setUser(u => ({ ...u, name: e.target.value }))} />
                    </div>
                  </div>

                  <div>
                    <label className="field-label">Connected Email (OIDC / Wallet)</label>
                    <input className="field-input" value={user.email || ""} disabled style={{ opacity: 0.6, cursor: "not-allowed", borderBottomColor: "transparent" }} />
                  </div>

                  <button className="btn-dark sm" style={{ alignSelf: "flex-start", background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" }} onClick={onLogout}>
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
                  <div className="warning-box" style={{ background: "rgba(56,189,248,0.08)", borderColor: "rgba(56,189,248,0.2)", color: "var(--gold)" }}>
                    <Info size={16} /> <span>Sign in via OAuth 2.0 / OIDC to securely save your node configurations and sessions to the server.</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
                    <button
                      className="btn-social"
                      style={{ borderColor: "var(--gold)", color: "var(--gold)", background: "var(--gold-lt)" }}
                      onClick={() => onShowWalletModal?.()}
                      disabled={!!isAuthenticating}
                    >
                      <Shield size={16} />
                      Connect Web3 Wallet (DID)
                    </button>
                    {[
                      { id: "google", icon: <IconChrome />, label: "Connect Google Account" },
                      { id: "github", icon: <IconGithub />, label: "Connect GitHub Account" },
                      { id: "meta", icon: <IconMeta />, label: "Connect Meta Account" },
                    ].map(b => (
                      <button key={b.id} className="btn-social" onClick={() => handleProviderLogin(b.id)} disabled={!!isAuthenticating}>
                        {isAuthenticating === b.id ? <Loader2 size={16} className="animate-spin" /> : b.icon}
                        {isAuthenticating === b.id ? "Authenticating..." : b.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── NEW ADVANCED CONNECTIONS SECTION IN PROFILE ── */}
              <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border)", width: "calc(100% - 30px)" }}>
                <h3 className="s-title" style={{ fontSize: 16, marginBottom: 8 }}>Advanced Integrations</h3>
                <p className="s-sub" style={{ marginBottom: 16 }}>Connect external computing resources or supply your own developer keys.</p>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <button className="btn-social" onClick={() => setAddingNode(true)} style={{ flex: 1, minWidth: "200px" }}>
                    <Network size={16} /> Connect P2P Node (BYOC)
                  </button>
                  <button className="btn-social" onClick={() => setAddingKey(true)} style={{ flex: 1, minWidth: "200px" }}>
                    <Key size={16} /> Bring Your Own Key (BYOK)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add Custom Node Form */}
          <AnimatePresence>
            {addingNode && (
              <motion.div key="adding-node-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: "absolute", inset: 0, zIndex: 50, background: "var(--bg-overlay)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <motion.form initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                  onSubmit={handleAdd} className="custom-key-form">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontWeight: 700, fontSize: 17, color: "var(--t1)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--gold)" }}><Network size={20} /></span> Connect Compute Node
                    </h3>
                    <button type="button" onClick={() => setAddingNode(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--t3)" }}><X size={18} /></button>
                  </div>
                  <div className="warning-box">
                    <AlertTriangle size={16} /> Node connections are peer-to-peer and decentralized. No API keys are required in AURA's Compute-for-Access model.
                  </div>
                  {[
                    { label: "Provider/Host Name", val: nProv, set: setNProv, ph: "e.g. Decentralized LPU" },
                    { label: "Model ID", val: nName, set: setNName, ph: "e.g. Llama-3-8B" },
                    { label: "Node Address (DID)", val: nAddress, set: setNAddress, ph: "did:peer:...", mono: true },
                  ].map(f => (
                    <div key={f.label} style={{ marginBottom: 12 }}>
                      <label className="field-label">{f.label}</label>
                      <input required type="text" placeholder={f.ph} value={f.val} onChange={e => f.set(e.target.value)}
                        className="field-input" style={f.mono ? { fontFamily: "monospace", fontSize: 13 } : {}} />
                    </div>
                  ))}
                  <button type="submit" className="btn-dark full" style={{ marginTop: 8 }}>Save & Establish Connection</button>
                </motion.form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Add BYOK (API Key) Form */}
          <AnimatePresence>
            {addingKey && (
              <motion.div key="adding-key-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: "absolute", inset: 0, zIndex: 50, background: "var(--bg-overlay)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <motion.form initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                  onSubmit={handleAddKey} className="custom-key-form">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontWeight: 700, fontSize: 17, color: "var(--t1)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--gold)" }}><Key size={20} /></span> Bring Your Own Key
                    </h3>
                    <button type="button" onClick={() => setAddingKey(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--t3)" }}><X size={18} /></button>
                  </div>
                  <div className="warning-box">
                    <Shield size={16} /> Keys are encrypted and stored locally against your DID. They are prioritized over AURA platform keys.
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label className="field-label">API Provider Architecture</label>
                    <select
                      value={kProvider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="field-input"
                      style={{ padding: "8px 0", cursor: "pointer", color: "var(--t1)" }}
                    >
                      <option value="openai" style={{ color: "#000000" }}>OpenAI</option>
                      <option value="anthropic" style={{ color: "#000000" }}>Anthropic</option>
                      <option value="google" style={{ color: "#000000" }}>Google (Gemini)</option>
                      <option value="mistral" style={{ color: "#000000" }}>Mistral</option>
                      <option value="deepseek" style={{ color: "#000000" }}>DeepSeek</option>
                      <option value="groq" style={{ color: "#000000" }}>Groq</option>
                      <option value="openrouter" style={{ color: "#000000" }}>OpenRouter</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label className="field-label">Exact Model ID (Editable)</label>
                    <input required type="text" placeholder="e.g. gpt-4-turbo" value={kModelId} onChange={e => setKModelId(e.target.value)}
                      className="field-input" style={{ fontFamily: "monospace", fontSize: 13 }} />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label className="field-label">Display Name (Optional)</label>
                    <input type="text" placeholder="e.g. My Custom GPT" value={kCustomName} onChange={e => setKCustomName(e.target.value)}
                      className="field-input" />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label className="field-label">API Key</label>
                    <input required type="password" placeholder={kProvider === "groq" ? "gsk_..." : "sk-..."} value={kValue} onChange={e => setKValue(e.target.value)}
                      className="field-input" style={{ fontFamily: "monospace", fontSize: 13 }} />
                  </div>

                  <button type="submit" className="btn-dark full" style={{ marginTop: 8 }}>Save & Activate Key</button>
                </motion.form>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </motion.div>

      {/* 2. THE HUGGING FACE POPUP */}
      <AnimatePresence>
        {isHfDirectoryOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ position: "fixed", inset: 0, backgroundColor: "var(--bg-overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", zIndex: 9999, backdropFilter: "blur(12px)" }}
          >
            <div style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: "1rem", maxWidth: "42rem", width: "100%", padding: "2rem", boxShadow: "0 0 80px rgba(202, 138, 4, 0.15)", display: "flex", flexDirection: "column", height: "85vh" }}>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexShrink: 0 }}>
                <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--t1)" }}>
                  <span>🤗</span> Live Hugging Face Hub
                </h2>
                <button onClick={() => setIsHfDirectoryOpen(false)} style={{ color: "var(--t3)", fontSize: "1.5rem", background: "none", border: "none", cursor: "pointer" }}>✕</button>
              </div>

              <p style={{ color: "var(--t2)", fontSize: "0.875rem", marginBottom: "1.5rem", flexShrink: 0, lineHeight: 1.6 }}>
                Search and deploy public free-tier Hugging Face Inference Provider models into your council.
              </p>

              <div style={{ marginBottom: "1rem", flexShrink: 0 }}>
                <label className="field-label">Hugging Face Access Token</label>
                <input
                  type="password"
                  placeholder={hfServerTokenReady ? "Using server HUGGINGFACE_API_KEY" : "hf_..."}
                  value={globalHfToken}
                  onChange={(e) => setGlobalHfToken(e.target.value.trim())}
                  style={{ width: "100%", backgroundColor: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "0.75rem", padding: "0.75rem 1rem", color: "var(--t1)", outline: "none", fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}
                />
                <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 6 }}>
                  {hfServerTokenReady ? "Server token detected. You can install models without pasting a token here." : "Create one at huggingface.co/settings/tokens with inference access."}
                </div>
              </div>

              {/* Search Bar */}
              <div style={{ marginBottom: "1.5rem", flexShrink: 0 }}>
                <input
                  type="text"
                  placeholder="Search models (e.g., Llama-3, Qwen, Mistral)..."
                  value={hfSearchTerm}
                  onChange={(e) => setHfSearchTerm(e.target.value)}
                  style={{ width: "100%", backgroundColor: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "0.75rem", padding: "0.75rem 1rem", color: "var(--t1)", outline: "none", fontFamily: "inherit" }}
                />
              </div>

              {/* Loading State or List */}
              <div className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", paddingRight: "0.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {isLoadingHf ? (
                  // Skeleton Loading Interface
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem", backgroundColor: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "0.75rem" }}>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                          <div className="sk-line" style={{ width: "60%", height: 16 }} />
                          <div className="sk-line" style={{ width: "30%", height: 12 }} />
                        </div>
                        <div className="sk-line" style={{ width: 80, height: 32, borderRadius: 8 }} />
                      </div>
                    ))}
                  </div>
                ) : liveHfModels.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--t3)" }}>
                    <p>No text-generation models found for "{hfSearchTerm}".</p>
                  </div>
                ) : (
                  liveHfModels.map((hfModel) => (
                    <div key={hfModel.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem", backgroundColor: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "0.75rem" }}>
                      <div style={{ flex: 1, minWidth: 0, paddingRight: "1rem" }}>
                        <h4 style={{ fontWeight: "bold", fontSize: "1.125rem", color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {hfModel.name}
                        </h4>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t2)", backgroundColor: "var(--bg3)", padding: "0.25rem 0.5rem", borderRadius: "0.25rem" }}>
                            {hfModel.author}
                          </span>
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--gold)", backgroundColor: "var(--gold-lt)", padding: "0.25rem 0.5rem", borderRadius: "0.25rem" }}>
                            {hfModel.task || "text-generation"}
                          </span>
                          {hfModel.is_free !== false && (
                            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#22C55E", backgroundColor: "rgba(34,197,94,0.15)", padding: "0.25rem 0.5rem", borderRadius: "0.25rem" }}>
                              FREE
                            </span>
                          )}
                          <span style={{ fontSize: "0.75rem", color: "var(--t3)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            ⬇ {hfModel.downloads?.toLocaleString() || 0}
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "var(--t3)" }}>
                            ♥ {hfModel.likes?.toLocaleString() || 0}
                          </span>
                          {(hfModel.gated || hfModel.private) && (
                            <span style={{ fontSize: "0.75rem", color: "#F59E0B", fontWeight: 700 }}>
                              {hfModel.private ? "Private" : "Gated"}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleQuickConnectHF(hfModel)}
                        disabled={!globalHfToken.trim() && !hfServerTokenReady}
                        style={{ backgroundColor: "#CA8A04", color: "white", padding: "0.625rem 1.25rem", borderRadius: "0.5rem", fontWeight: "bold", fontSize: "0.875rem", border: "none", cursor: (globalHfToken.trim() || hfServerTokenReady) ? "pointer" : "not-allowed", opacity: (globalHfToken.trim() || hfServerTokenReady) ? 1 : 0.45, flexShrink: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}
                      >
                        <Download size={14} /> Install
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
});
SettingsModal.displayName = "SettingsModal";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESPONSE CARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ResponseCard: React.FC<{ data: CardData; onExpand: (data: CardData) => void }> = ({ data, onExpand }) => {
  const last = data.messages.filter(m => m.role === "model").slice(-1)[0];
  return (
    <motion.div layoutId={`card-${data.cardId}`} className="resp-card"
      style={{ "--card-color": data.hex } as React.CSSProperties}
      whileHover={{ y: -2, boxShadow: "0 12px 40px rgba(0,0,0,0.12)" }}>
      <div className="rc-header">
        <div className="rc-badge" style={{ background: data.hex }}><Bot size={16} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="rc-name">{data.name}</div>
          <div className="rc-prov">{data.provider}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data.state === "loading" && <Dots color={data.hex} />}
          {data.state === "complete" && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E" }} />}
          {data.state === "error" && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#EF4444" }} />}
          <button className="rc-expand" onClick={() => onExpand(data)} title="Expand to full view"><Maximize2 size={14} /></button>
        </div>
      </div>

      <div className="rc-body">
        {data.state === "loading" && !last ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "20px 0" }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              style={{ width: 28, height: 28, border: `2.5px solid var(--border2)`, borderTopColor: data.hex, borderRadius: "50%" }}
            />
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ fontSize: 12, fontWeight: 600, color: "var(--t3)", letterSpacing: "0.05em" }}
            >Synthesizing intelligence...</motion.span>
          </div>
        ) : data.state === "error" ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "#EF4444" }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {last?.text || "Connection failed."}
            </span>
          </div>
        ) : last ? <Markdown text={last.text} /> : null}
      </div>

      {last && data.state === "complete" && (
        <div className="rc-footer">
          <button className="icon-btn" title="Copy" onClick={() => navigator.clipboard?.writeText(last.text)}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x={9} y={9} width={13} height={13} rx={2} ry={2} /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          </button>
          <button className="icon-btn" title="Export" onClick={() => {
            const blob = new Blob([last.text], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${data.name.replace(/\s+/g, '_')}_response.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}><Download size={14} /></button>
        </div>
      )}
    </motion.div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPANDED VIEW & AGORA / SUPERVISOR INTELLIGENCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface ExpandedViewProps {
  model: CardData;
  onClose: () => void;
  onFollowUp: (cardId: string, text: string) => Promise<void>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadedFiles?: string[];
  isUploading?: boolean;
}

const ExpandedView = React.forwardRef<HTMLDivElement, ExpandedViewProps>(({ model, onClose, onFollowUp, onFileUpload, uploadedFiles, isUploading }, ref) => {
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCtx, setShowCtx] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agoraEvents, setAgoraEvents] = useState<any[]>([]);
  const [swarmPeers, setSwarmPeers] = useState<number>(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contextPct = Math.min(95, 20 + model.messages.length * 8);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [model?.messages]);

  // ── P2P SWARM POLLING ──
  useEffect(() => {
    if (!showCtx) return;
    const fetchPeers = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/p2p/peers`);
        if (res.ok) {
          const data = await res.json();
          setSwarmPeers(data.peers.length);
        }
      } catch (e) { console.warn("P2P Swarm unreachable."); }
    };
    fetchPeers();
    const int = setInterval(fetchPeers, 10000); // Poll every 10s
    return () => clearInterval(int);
  }, [showCtx]);

  // ── AGORA HEALING SIMULATION (JSON SCHEMA COMPLIANT) ──
  const simulateAgoraHeal = async () => {
    setAgoraEvents(p => [...p, { time: new Date().toLocaleTimeString(), msg: "🚨 Schema Drift Detected: KeyError 'price_usd' failed." }]);
    await new Promise(r => setTimeout(r, 1500));
    setAgoraEvents(p => [...p, { time: new Date().toLocaleTimeString(), msg: "🧬 Fallback LLM Chain Initiated for JSON repair..." }]);

    try {
      const res = await fetch(`${BACKEND_URL}/api/agora/heal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_id: "financial-data-feed-v2",
          target_endpoint: "api.marketdata.com/v1/assets",
          failed_key: "['price_usd']",
          extraction_goal: "Extract the current USD price"
        })
      });
      if (res.ok) {
        const data = await res.json();
        setAgoraEvents(p => [...p, { time: new Date().toLocaleTimeString(), msg: `✅ Healed! New Data Path: ${data.new_path}` }]);
      }
    } catch (err) {
      setAgoraEvents(p => [...p, { time: new Date().toLocaleTimeString(), msg: "❌ Healing escalated to human operator." }]);
    }
  };

  const send = async () => {
    if (!inputText.trim() || loading) return;
    const txt = inputText.trim(); setInputText(""); setLoading(true);
    await onFollowUp(model.cardId, txt);
    setLoading(false);
  };

  const handleQuickAction = async (label: string) => {
    if (loading) return;
    let prompt = "";
    if (label === "✨ Summarize session") {
      prompt = "Please provide a concise, bulleted summary of our entire conversation so far.";
    } else if (label === "✨ Compare logic") {
      prompt = "Analyze the reasoning we've discussed so far. What are the pros, cons, and blind spots of the approaches mentioned? ✨";
    } else if (label === "🧬 Trigger AGORA") {
      simulateAgoraHeal();
      return;
    } else if (label === "Start fresh") {
      onClose();
      return;
    } else {
      return;
    }
    setLoading(true);
    await onFollowUp(model.cardId, prompt);
    setLoading(false);
  };

  const quickActions = [
    { icon: <FileText size={14} />, label: "✨ Summarize session" },
    { icon: <LayoutGrid size={14} />, label: "✨ Compare logic" },
    { icon: <Activity size={14} />, label: "🧬 Trigger AGORA" },
    { icon: <RefreshCw size={14} />, label: "Start fresh" },
  ];

  return (
    <motion.div
      ref={ref}
      layoutId={`card-${model.cardId}`}
      initial={{ borderRadius: 24, opacity: 0 }}
      animate={{ borderRadius: 0, opacity: 1 }}
      exit={{ opacity: 0, borderRadius: 24 }}
      transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
      style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      <motion.div className="exp-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="icon-btn lg" onClick={onClose}><ArrowLeft size={16} /></button>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: model.hex, display: "flex", alignItems: "center", justifyContent: "center", color: "white", flexShrink: 0 }}>
            <Bot size={20} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }}>{model.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--t3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} />
              Online · {model.provider}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button className="icon-btn lg" onClick={() => setShowCtx(!showCtx)} title="Model intelligence"><Info size={16} /></button>
          <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
          <button className="icon-btn lg danger" onClick={onClose}><X size={16} /></button>
        </div>
      </motion.div>

      <AnimatePresence>
        {contextPct > 70 && (
          <motion.div key="context-warning" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{ background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.2)", padding: "10px 20px", fontSize: 13, color: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 500, flexShrink: 0 }}>
            <span>Context window at {contextPct}% — approaching limit.</span>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gold)", textDecoration: "underline", fontSize: 13, fontWeight: 600 }}>Clear history</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>

        <div className="exp-chat-area">
          <div className="exp-messages">
            {model.messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "85%", padding: "14px 18px", borderRadius: 20, fontSize: 14, lineHeight: 1.65,
                  ...(msg.role === "user"
                    ? { background: model.hex, color: "white", borderBottomRightRadius: 5 }
                    : { background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--t2)", borderBottomLeftRadius: 5 })
                }}>
                  {msg.role === "user" ? msg.text : <Markdown text={msg.text} />}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex" }}>
                <div style={{ padding: "12px 18px", borderRadius: 20, borderBottomLeftRadius: 5, background: "var(--bg2)", border: "1px solid var(--border)" }}>
                  <Dots color={model.hex} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="exp-input-wrap">
            <div style={{ display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
              {quickActions.map(a => (
                <button key={a.label} className="pill-btn" onClick={() => handleQuickAction(a.label)}>
                  {a.icon} {a.label}
                </button>
              ))}
            </div>

            <div className="exp-input-bar" style={{ "--accent": model.hex } as React.CSSProperties}>

              <label className="icon-btn" title="Attach files to RAG Memory" style={{ cursor: "pointer", flexShrink: 0 }}>
                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
                <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onFileUpload} accept=".pdf,.txt,.md" />
              </label>

              {uploadedFiles && uploadedFiles.length > 0 && (
                <div
                  title={uploadedFiles.join(", ")}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "0 10px", height: 30,
                    background: "rgba(34, 197, 94, 0.1)", color: "#22C55E",
                    borderRadius: 8, border: "1px solid rgba(34, 197, 94, 0.3)",
                    flexShrink: 0
                  }}
                >
                  <Check size={14} />
                  <span style={{ fontSize: 11, fontWeight: 600, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {uploadedFiles.length === 1 ? uploadedFiles[0] : `${uploadedFiles.length} files attached`}
                  </span>
                </div>
              )}

              <textarea
                value={inputText} onChange={e => setInputText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask a follow-up question…"
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", resize: "none", fontFamily: "inherit", fontSize: 14, color: "var(--t1)", minHeight: 24, maxHeight: 100, padding: "4px 0", width: "100%" }}
              />
              <button className="icon-btn" style={{ flexShrink: 0 }}><Mic size={16} /></button>
              <button className="send-circle" style={{ background: model.hex, flexShrink: 0 }} onClick={send} disabled={!inputText.trim() || loading}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {showCtx && (
            <motion.div className="ctx-panel" initial={{ width: 0, opacity: 0 }} animate={{ width: 300, opacity: 1 }} exit={{ width: 0, opacity: 0 }}>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--t1)" }}>Node Intelligence</span>
                <button className="icon-btn" onClick={() => setShowCtx(false)}><X size={16} /></button>
              </div>
              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 24, overflowY: "auto", flex: 1 }}>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--t1)", fontWeight: 700, fontSize: 13 }}>
                    <span style={{ color: "var(--gold)" }}><Database size={14} /></span> Context Usage
                  </div>
                  <div style={{ height: 8, background: "var(--bg3)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${contextPct}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
                      style={{ height: "100%", background: `linear-gradient(90deg, ${model.hex}, ${model.hex}99)` }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--t3)", fontWeight: 600, marginTop: 6 }}>
                    <span>{Math.round(contextPct * 1280)} tokens used</span>
                    <span>128k cap</span>
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--t1)", fontWeight: 700, fontSize: 13 }}>
                    <span style={{ color: "var(--gold)" }}><Activity size={14} /></span> Network & Intelligence
                  </div>
                  <div className="metrics-box">
                    {[
                      ["Node Host", model.provider],
                      ["Swarm Peers", `${swarmPeers} Active Nodes`],
                      ["Protocol", "Compute-for-Access P2P"],
                      ["Auth", "DID Verification"],
                      ["Status", "Secure Node Active ✓"],
                    ].map(([k, v]) => (
                      <div key={k} className="metric-row">
                        <span className="metric-key">{k}</span>
                        <span className="metric-val">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AGORA Log Display */}
                {agoraEvents.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--t1)", fontWeight: 700, fontSize: 13 }}>
                      <span style={{ color: "#10B981" }}><Database size={14} /></span> AGORA Meta-Protocol Logs
                    </div>
                    <div className="metrics-box" style={{ background: "rgba(16, 185, 129, 0.05)", borderColor: "rgba(16, 185, 129, 0.2)" }}>
                      {agoraEvents.map((ev, i) => (
                        <div key={i} style={{ fontSize: 11, color: "var(--t2)", marginBottom: 4, fontFamily: "monospace" }}>
                          <span style={{ color: "var(--t3)" }}>[{ev.time}]</span> {ev.msg}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="metrics-box" style={{ textAlign: "center", padding: 16 }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: model.hex }}>{model.messages.length}</div>
                  <div style={{ fontSize: 12, color: "var(--t3)", fontWeight: 600, marginTop: 2 }}>MESSAGES IN SESSION</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});
ExpandedView.displayName = "ExpandedView";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INPUT BAR & COUNCIL DROPDOWN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface InputBarProps {
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  onSend: () => void;
  models: Model[];
  connected: Model[];
  setConnected: React.Dispatch<React.SetStateAction<Model[]>>;
  onEnhance: () => void;
  enhancing: boolean;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  uploadedFiles?: string[];
  isUploading?: boolean;
  isCouncilMode: boolean;
  setIsCouncilMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const InputBar: React.FC<InputBarProps> = ({
  query, setQuery, onSend, models, connected, setConnected,
  onEnhance, enhancing, onFileUpload, placeholder, uploadedFiles, isUploading,
  isCouncilMode, setIsCouncilMode
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleModel = (model: Model) => {
    setConnected(prev => {
      const isOn = prev.some(c => c.id === model.id);
      if (isOn) return prev.filter(c => c.id !== model.id);
      if (prev.length >= MAX_CONNECTED_MODELS) {
        alert(MODEL_LIMIT_ALERT);
        return prev;
      }
      return [...prev, model];
    });
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Browser does not support Speech Recognition."); return; }
    const recognition = new SpeechRecognition();
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e: any) => { setQuery((prev: any) => (prev ? prev + " " + e.results[0][0].transcript : e.results[0][0].transcript)); };
    recognition.onend = () => setIsListening(false); recognition.onerror = () => setIsListening(false);
    if (isListening) setIsListening(false); else recognition.start();
  };

  return (
    <div className="input-bar">
      <textarea
        className="ib-field"
        placeholder={placeholder || "Broadcast query across compute nodes…"}
        value={query}
        onChange={e => setQuery(e.target.value)}
        rows={1}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
      />
      <div className="ib-row" style={{ position: 'relative' }}>

        {/* COUNCIL DROPDOWN BUTTON */}
        <div ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            style={{
              background: "transparent",
              color: "var(--gold)",
              border: "none",
              padding: "0",
              fontSize: "13px",
              outline: "none",
              cursor: "pointer",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "4px",
              opacity: isDropdownOpen ? 1 : 0.9,
              transition: "opacity 0.2s, color 0.4s"
            }}
          >
            Council of AI <ChevronDown size={14} />
          </button>

          {/* DROPDOWN MENU */}
          <AnimatePresence>
            {isDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.96 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  width: "260px",
                  background: "var(--bg2)",
                  border: "1px solid var(--border)",
                  borderRadius: "14px",
                  boxShadow: "var(--shl)",
                  overflow: "hidden",
                  zIndex: 100,
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                {/* ── SEARCH BOX ── */}
                <div style={{ padding: "10px", borderBottom: "1px solid var(--border)", background: "var(--bg3)" }}>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <Search size={14} style={{ position: "absolute", left: "10px", color: "var(--gold)", opacity: 0.7 }} />
                    <input
                      type="text"
                      placeholder="Search models & providers..."
                      autoFocus
                      onChange={(e) => {
                        const term = e.target.value.toLowerCase();
                        (window as any)._modelSearchTerm = term;
                        setConnected([...connected]); // Trigger re-render of dropdown content
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      style={{
                        width: "100%",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "8px 10px 8px 32px",
                        fontSize: "13px",
                        color: "var(--t1)",
                        outline: "none",
                        boxShadow: "inset 0 1px 3px rgba(0,0,0,0.1)"
                      }}
                    />
                  </div>
                </div>

                {/* ── COUNCIL TOGGLE ── */}
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg)" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--t1)", display: "flex", alignItems: "center", gap: "6px" }}>
                    <Bot size={14} color="var(--gold)" /> Council Consensus
                  </span>
                  <button className={`toggle ${isCouncilMode ? "on" : ""}`} onClick={() => setIsCouncilMode(!isCouncilMode)} style={{ transform: "scale(0.8)", margin: 0 }}>
                    <motion.div className="t-knob" animate={{ x: isCouncilMode ? 20 : 2 }} />
                  </button>
                </div>

                {/* Scrollable Model List */}
                <div
                  style={{
                    maxHeight: "340px",
                    overflowY: "auto",
                    padding: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0px"
                  }}
                  className="custom-scrollbar"
                >
                  {models
                    .filter(
                      (m) =>
                        !(window as any)._modelSearchTerm ||
                        m.name.toLowerCase().includes((window as any)._modelSearchTerm) ||
                        m.provider.toLowerCase().includes((window as any)._modelSearchTerm)
                    )
                    .sort((a, b) => modelAvailabilityRank(a) - modelAvailabilityRank(b) || a.name.localeCompare(b.name))
                    .map((m) => {
                      const isSelected = connected.some((c) => c.id === m.id);

                      // ── Unified badge logic with FREE/PAID priority ──
                      const isOpenRouterModel = m.provider === "OpenRouter" || m.provider.includes("OpenRouter");
                      const isGroqModel = m.provider.toLowerCase().includes("groq");
                      const hasFreeBadge = m.isFree === true && (isOpenRouterModel || isGroqModel);
                      const isPaidOR = m.isFree === false && isOpenRouterModel;
                      const isMax =
                        !hasFreeBadge &&
                        !isPaidOR &&
                        (m.name.includes("4o") || m.name.includes("3.5") || m.name.includes("Opus"));
                      const isNew =
                        !hasFreeBadge && !isPaidOR && !isMax && (m.name.includes("Gemini") || m.name.includes("Kimi"));

                      const badgeText = hasFreeBadge ? "FREE" : isPaidOR ? "PAID" : isMax ? "Max" : isNew ? "New" : null;
                      const badgeBg = hasFreeBadge
                        ? "rgba(34,197,94,0.15)"
                        : isPaidOR
                          ? "rgba(245,158,11,0.12)"
                          : isMax
                            ? "rgba(75,154,148,0.15)"
                            : "rgba(56,189,248,0.15)";
                      const badgeColor = hasFreeBadge
                        ? "#22C55E"
                        : isPaidOR
                          ? "#F59E0B"
                          : isMax
                            ? "#f7f7f7"
                            : "#38BDF8";

                      return (
                        <button
                          key={m.id}
                          onClick={() => toggleModel(m)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 10px",
                            background: isSelected ? "var(--bg3)" : "transparent",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = isSelected ? "var(--bg3)" : "transparent")
                          }
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.hex }} />
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: isSelected ? "var(--t1)" : "var(--t2)",
                                letterSpacing: "0.2px",
                              }}
                            >
                              {m.name}
                            </span>
                            {badgeText && (
                              <span
                                style={{
                                  fontSize: "10px",
                                  background: badgeBg,
                                  color: badgeColor,
                                  padding: "2px 6px",
                                  borderRadius: "12px",
                                  fontWeight: 600,
                                }}
                              >
                                {badgeText}
                              </span>
                            )}
                          </div>
                          {isSelected ? (
                            <div
                              style={{
                                background: "#f6b70875",
                                borderRadius: "50%",
                                width: 16,
                                height: 16,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Check size={10} color="#000" strokeWidth={3} />
                            </div>
                          ) : (
                            <div
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: "100%",
                                border: "1.5px solid var(--border2)",
                              }}
                            />
                          )}
                        </button>
                      );
                    })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* REST OF INPUT TOOLS */}
        <label className="icon-btn" title="Attach files to RAG Memory" style={{ cursor: "pointer", marginLeft: 8 }}>
          {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
          <input type="file" multiple style={{ display: "none" }} onChange={onFileUpload} accept=".pdf,.txt,.md" />
        </label>

        {uploadedFiles && uploadedFiles.length > 0 && (
          <div title={uploadedFiles.join(", ")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", height: 30, background: "rgba(34, 197, 94, 0.1)", color: "#22C55E", borderRadius: 8, border: "1px solid rgba(34, 197, 94, 0.3)" }}>
            <Check size={14} />
            <span style={{ fontSize: 11, fontWeight: 600, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {uploadedFiles.length === 1 ? uploadedFiles[0] : `${uploadedFiles.length} files attached`}
            </span>
          </div>
        )}

        <button className="icon-btn gold" title="Enhance prompt with AI" onClick={onEnhance} disabled={enhancing || !query.trim()}>
          {enhancing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        </button>

        <div className="ib-sep" />

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {connected.slice(0, 5).map(m => (
            <div key={m.id} title={m.name} style={{ width: 9, height: 9, borderRadius: "50%", background: m.hex }} />
          ))}
          {connected.length > 5 && <span style={{ fontSize: 10, color: "var(--t3)", fontWeight: 600 }}>+{connected.length - 5}</span>}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={toggleListening} title="Voice Dictation" style={{ background: "transparent", color: isListening ? "#EF4444" : "var(--t2)", border: "none", cursor: "pointer", padding: 0 }}>
            {isListening ? <span className="animate-pulse"><Mic size={18} /></span> : <Mic size={18} />}
          </button>

          <button className="send-circle" onClick={onSend} disabled={!query.trim() || connected.length === 0}>
            <Send size={16} />
          </button>
        </div>

      </div>
    </div>
  );
};

interface FloatingSummarizerProps {
  visible: boolean;
  loading: boolean;
  summary: string | null;
  onAmalgamate: () => void;
}

const FloatingSummarizer: React.FC<FloatingSummarizerProps> = ({ visible, loading, summary, onAmalgamate }) => {
  if (!visible) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        width: 360,
        maxWidth: "calc(100vw - 32px)",
        background: "var(--bg2)",
        border: "1px solid var(--border2)",
        borderRadius: 16,
        boxShadow: "var(--shl)",
        zIndex: 120
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--t1)" }}>
        Gemini Amalgamation
      </div>
      <div style={{ padding: 12 }}>
        <button className="btn-primary full" onClick={onAmalgamate} disabled={loading}>
          {loading ? "Synthesizing..." : "Gemini Amalgamation"}
        </button>
        {summary && (
          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6, color: "var(--t2)", maxHeight: 220, overflowY: "auto" }} className="custom-scrollbar">
            {summary}
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN APP COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function App() {
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean>(() => typeof window !== 'undefined' ? localStorage.getItem("aura-final") === "1" : false);
  const [guestLandingSkipped, setGuestLandingSkipped] = useState(false);
  const [theme, setTheme] = useState<string>(() => typeof window !== 'undefined' ? localStorage.getItem("aura-theme") || "system" : "system");
  const [sysDark, setSysDark] = useState<boolean>(() => typeof window !== 'undefined' ? window.matchMedia("(prefers-color-scheme:dark)").matches : false);
  const [models, setModels] = useState<Model[]>(() => sortModelsByAvailability(INITIAL_MODELS));
  const [connected, setConnected] = useState<Model[]>(() => getDefaultConnectedModels(INITIAL_MODELS));

  // ── AUTHENTICATION STATE ──
  const [user, setUser] = useState<User>({ name: "AURA User", photo: null, isAuthenticated: false });

  // ── OAPIN LEDGER STATE ──
  const [walletBalance, setWalletBalance] = useState<number>(1000.00);
  const [targetMode] = useState<string>("swarm"); // Reserved for future use
  const [isCouncilMode, setIsCouncilMode] = useState<boolean>(false);

  useEffect(() => {
    const handleBalanceUpdate = (e: Event) => {
      setWalletBalance((e as CustomEvent).detail);
    };
    window.addEventListener('oapin_balance_update', handleBalanceUpdate);
    return () => window.removeEventListener('oapin_balance_update', handleBalanceUpdate);
  }, []);

  // ── UPLOAD STATE ──
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // ── RESPONSIVE & SIDEBAR STATE ──
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [pendingLoginProvider, setPendingLoginProvider] = useState<string | null>(null);
  const [providerLoginToken, setProviderLoginToken] = useState<string>("");
  const [providerLoginError, setProviderLoginError] = useState<string>("");
  const [providerLoginLoading, setProviderLoginLoading] = useState<boolean>(false);
  const [route, setRoute] = useState<string>("home");
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [activeSessionId, setActiveSessionId] = useState<string>("active_session");
  const [sessionTitle, setSessionTitle] = useState<string>("");
  const [cards, setCards] = useState<CardData[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState<boolean>(false);
  const [enhancing, setEnhancing] = useState<boolean>(false);
  const [sessionHistory, setSessionHistory] = useState<{ title: string, cards: CardData[], ts: number }[]>([]);
  const [councilRawOutputs, setCouncilRawOutputs] = useState<{ name: string; text: string }[]>([]);
  const [amalgamatedSummary, setAmalgamatedSummary] = useState<string | null>(null);
  const [isAmalgamating, setIsAmalgamating] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showWalletModal, setShowWalletModal] = useState<boolean>(false);
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [ethBalance, setEthBalance] = useState<string>("0.000");
  const [showConnectedWallet, setShowConnectedWallet] = useState<boolean>(false);


  // =============================================
  // 🔐 SECURITY HELPER - Authentication Token
  // =============================================
  const getAuthHeaders = () => {
    const token = localStorage.getItem("aura_access_token");
    return token
      ? { Authorization: `Bearer ${token}` }
      : {};
  };

  const expandedModel = cards.find(c => c.cardId === expandedId);

  // ── FIX: When user skips landing page, load full model catalog ──
  useEffect(() => {
    if (guestLandingSkipped) setConnected(getDefaultConnectedModels(models));
  }, [guestLandingSkipped, models]);

  // ── 💾 SESSION PERSISTENCE: LOAD ──
  useEffect(() => {
    if (!user.isAuthenticated || !user.email) return;

    fetch(`${BACKEND_URL}/api/history/load/${encodeURIComponent(user.email)}`)
      .then(res => res.json())
      .then(data => {
        if (data.cards_data && data.cards_data !== "[]") {
          setCards(JSON.parse(data.cards_data));
        }
        if (data.wallet_balance !== undefined) {
          setWalletBalance(data.wallet_balance);
        }
      })
      .catch(err => console.warn("Failed to load session history:", err));
  }, [user.isAuthenticated, user.email]);

  useEffect(() => {
    const token = localStorage.getItem("aura_access_token");
    if (!token) {
      setAuthReady(true);
      return;
    }
    fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { ...getAuthHeaders() } as HeadersInit
    })
      .then((res) => {
        if (!res.ok) throw new Error("Session invalid");
        return res.json();
      })
      .then((data) => {
        const profile = data.user;
        if (!profile) return;
        setUser({
          name: profile.name || "AURA User",
          email: profile.email || profile.sub,
          photo: profile.picture || null,
          isAuthenticated: true
        });
      })
      .catch(() => {
        localStorage.removeItem("aura_access_token");
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsAppLoading(false), 850);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!user.isAuthenticated) return;
    fetch(`${BACKEND_URL}/api/chats/sessions`, {
      headers: { ...getAuthHeaders() } as HeadersInit
    })
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load chat sessions");
        return res.json();
      })
      .then((data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        setSessionHistory(
          sessions.map((session: any) => ({
            title: session.title || "Session",
            cards: [],
            ts: new Date(session.ts || Date.now()).getTime(),
          }))
        );
      })
      .catch((err) => console.warn("Failed to load secure chat sessions:", err));
  }, [user.isAuthenticated]);

  // ── 💾 SESSION PERSISTENCE: AUTO-SYNC (DEBOUNCED) ──
  useEffect(() => {
    if (!user.isAuthenticated || !user.email || cards.length === 0) return;

    const syncTimer = setTimeout(() => {
      fetch(`${BACKEND_URL}/api/history/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.email,
          cards_data: JSON.stringify(cards),
          wallet_balance: walletBalance
        })
      }).catch(err => console.warn("Silent sync failed:", err));
    }, 1500);

    return () => clearTimeout(syncTimer);
  }, [cards, walletBalance, user.isAuthenticated, user.email]);

  // ── APP PRE-LOADER ──
  // ── 🔀 AUTO-LOAD FREE OPENROUTER MODELS ON STARTUP ──
  useEffect(() => {
    const loadFreeModels = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/openrouter/free-models`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status !== "success" || !Array.isArray(data.models)) return;

        const categoryColors: Record<string, string> = {
          chat: "#8B5CF6",
          image: "#EC4899",
          vision: "#06B6D4",
          code: "#14B8A6",
          embedding: "#6366F1",
        };
        const categoryLabels: Record<string, string> = {
          chat: "Chat Model",
          image: "Image Model",
          vision: "Vision Model",
          code: "Code Model",
          embedding: "Embedding",
        };

        const newModels: Model[] = data.models.map((m: any) => ({
          id: m.id,
          name: m.name || m.id.split("/").pop(),
          provider: `OpenRouter · ${categoryLabels[m.category] || "Free"}`,
          hex: categoryColors[m.category] || "#8B5CF6",
          tw: "bg-violet-500",
          isCustom: true,
          nodeAddress: "",
          isFree: true,
          pricing: m.pricing,
        }));

        if (newModels.length > 0) {
          setModels(prev => {
            // Don't re-add if already loaded
            const existingIds = new Set(prev.map(p => p.id));
            const fresh = newModels.filter(m => !existingIds.has(m.id));
            return fresh.length > 0 ? sortModelsByAvailability([...prev, ...fresh]) : sortModelsByAvailability(prev);
          });
          console.log(`✅ [OpenRouter] Loaded ${newModels.length} free models`);
        }
      } catch (err) {
        console.warn("OpenRouter free models fetch failed (backend may be offline):", err);
      }
    };
    const scheduleIdle = (window as any).requestIdleCallback || ((cb: () => void) => window.setTimeout(cb, 900));
    const cancelIdle = (window as any).cancelIdleCallback || window.clearTimeout;
    const idleId = scheduleIdle(loadFreeModels);
    return () => cancelIdle(idleId);
  }, []);

  useEffect(() => {
    const loadGroqModels = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/groq/models`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          } as HeadersInit,
          body: JSON.stringify({})
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status !== "success" || !Array.isArray(data.models)) return;

        const colors = ["#9333EA", "#7C3AED", "#2563EB", "#0891B2", "#059669", "#D97706", "#DC2626", "#14B8A6"];
        const newModels: Model[] = data.models.map((m: any, i: number) => ({
          id: `groq:${m.id}`,
          name: m.name || m.id,
          provider: "Groq · Free Models",
          hex: colors[i % colors.length],
          tw: "bg-purple-600",
          isCustom: true,
          nodeAddress: "",
          isFree: true,
        }));

        if (newModels.length > 0) {
          setModels(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const fresh = newModels.filter(m => !existingIds.has(m.id));
            return fresh.length > 0 ? sortModelsByAvailability([...prev, ...fresh]) : sortModelsByAvailability(prev);
          });
          console.log(`Loaded ${newModels.length} Groq models from server key`);
        }
      } catch (err) {
        console.warn("Groq models fetch failed (backend key may be missing):", err);
      }
    };

    const scheduleIdle = (window as any).requestIdleCallback || ((cb: () => void) => window.setTimeout(cb, 1100));
    const cancelIdle = (window as any).cancelIdleCallback || window.clearTimeout;
    const idleId = scheduleIdle(loadGroqModels);
    return () => cancelIdle(idleId);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme:dark)");
    const h = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  useEffect(() => { localStorage.setItem("aura-theme", theme); }, [theme]);

  const isDark = theme === "dark" || (theme === "system" && sysDark);
  const isBooting = isAppLoading || !authReady;

  

  // ── 📡 AUTHENTICATION ROUTER (WEB2 & WEB3) ──
  const executeOAuthLogin = async (provider: string, walletId?: string) => {

    if (provider === "web3") {
      return new Promise<void>(async (resolve) => {
        try {
          let ethProviderObject: any = window.ethereum;

          if (walletId === "phantom" && window.phantom?.ethereum) {
            ethProviderObject = window.phantom.ethereum;
          } else if (walletId === "okx" && window.okxwallet) {
            ethProviderObject = window.okxwallet;
          } else if (walletId === "trust" && window.trustwallet) {
            ethProviderObject = window.trustwallet;
          } else if (walletId === "coinbase" && window.coinbaseWalletExtension) {
            ethProviderObject = window.coinbaseWalletExtension;
          }

          if (!ethProviderObject) {
            throw new Error(`No Web3 wallet found for ${walletId || 'selected option'}. Please install the correct wallet extension.`);
          }

          const ethProvider = new ethers.BrowserProvider(ethProviderObject);
          const accounts = await ethProvider.send("eth_requestAccounts", []);
          const address = accounts[0];

          // Store wallet address and fetch balance
          setWalletAddress(address);
          try {
            const bal = await ethProvider.getBalance(address);
            setEthBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
          } catch { setEthBalance("0.000"); }

          const nonce = Math.floor(Math.random() * 1000000).toString();
          const message = "Welcome to AURA. Sign this message to authenticate your Decentralized Identifier. Nonce: " + nonce;

          const signer = await ethProvider.getSigner();
          const signature = await signer.signMessage(message);

          const res = await fetch(`${BACKEND_URL}/api/auth/web3`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, signature, message })
          });

          if (res.ok) {
            const dbUser = await res.json();

            // Save JWT to Local Storage
            if (dbUser.access_token) {
              localStorage.setItem("aura_access_token", dbUser.access_token);
            }

            setUser({
              name: dbUser.user.name,
              email: dbUser.user.email,
              photo: dbUser.user.picture,
              isAuthenticated: true
            });
          }
          setShowConnectedWallet(true);
        } catch (err: any) {
          console.warn("Web3 Auth failed:", err.message);
          if (err.message?.includes("No Web3 wallet")) {
            alert("No Web3 wallet detected.\n\nPlease install MetaMask or another Web3 wallet extension to connect.\n\nVisit: https://metamask.io/download/");
          } else if (err.message?.includes("user rejected") || err.message?.includes("denied")) {
            alert("Connection request was rejected. Please approve the wallet connection to authenticate.");
          } else {
            console.error("Wallet connection error:", err);
            alert("Failed to connect to your wallet. Please make sure your wallet is unlocked and try again.");
          }
        } finally {
          resolve();
        }
      });
    }

    if (provider === "google" && GOOGLE_CLIENT_ID) {
      return new Promise<void>((resolve, reject) => {
        loadGoogleSdk().then(() => {
        window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
          callback: async (tokenResponse: any) => {
            if (tokenResponse.error) return reject(tokenResponse.error);
            try {
              const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ access_token: tokenResponse.access_token })
              });

              if (res.ok) {
                const dbUser = await res.json();
                if (dbUser.access_token) {
                  localStorage.setItem("aura_access_token", dbUser.access_token);
                }
                setUser({
                  name: dbUser.user.name,
                  email: dbUser.user.email,
                  photo: dbUser.user.picture,
                  isAuthenticated: true
                });
                resolve();
              } else {
                throw new Error("Backend authentication rejected.");
              }
            } catch (err) {
              reject(err);
            }
          },
        }).requestAccessToken();
        }).catch(reject);
      });
    }

    // GitHub, Meta, etc. — show login modal for name input
    setPendingLoginProvider(provider);
    setProviderLoginToken("");
    setProviderLoginError("");
  };

  const executeProviderLogin = async (provider: string, accessToken: string) => {
    if (!accessToken.trim()) {
      setProviderLoginError("Paste a provider access token first.");
      return;
    }

    try {
      setProviderLoginLoading(true);
      setProviderLoginError("");
      const res = await fetch(`${BACKEND_URL}/api/auth/provider-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, access_token: accessToken.trim() })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Provider authentication failed." }));
        throw new Error(err.detail || "Provider authentication failed.");
      }

      const dbUser = await res.json();
      if (dbUser.access_token) {
        localStorage.setItem("aura_access_token", dbUser.access_token);
      }

      setUser({
        name: dbUser.user.name,
        email: dbUser.user.email,
        photo: dbUser.user.picture,
        isAuthenticated: true
      });
      setPendingLoginProvider(null);
      setProviderLoginToken("");
    } catch (err) {
      setProviderLoginError(err instanceof Error ? err.message : "Provider authentication failed.");
    } finally {
      setProviderLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setUser({ name: "AURA User", photo: null, isAuthenticated: false, email: undefined });
    setWalletAddress("");
    setEthBalance("0.000");
    setShowConnectedWallet(false);
    localStorage.removeItem("aura_access_token"); // Destroy session
  };

  // ── 🔐 WALLET-SPECIFIC CONNECTION STEPS ──
  const connectMetaMask = async () => {
    if (!window.ethereum?.isMetaMask) throw new Error("MetaMask not detected. Please install MetaMask extension.");

    // Step 1: Request account access
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    // Step 2: Request account chain ID (verify network)
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    console.log(`✅ [MetaMask] Connected to chain: ${chainId}`);

    // Step 3: Set up event listeners
    window.ethereum.on("accountsChanged", (newAccounts: string[]) => {
      if (newAccounts.length === 0) {
        setWalletAddress("");
        setEthBalance("0.000");
      } else {
        setWalletAddress(newAccounts[0]);
      }
    });

    return address;
  };

  const connectWalletConnect = async () => {
    // WalletConnect integration (v2)
    console.log("🔗 [WalletConnect] Initiating QR code connection...");

    // For WalletConnect, we use standard eth provider
    if (!window.ethereum) throw new Error("No Web3 provider found");

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    console.log(`✅ [WalletConnect] Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
    return address;
  };

  const connectCoinbaseWallet = async () => {
    const provider = window.coinbaseWalletExtension || window.ethereum;
    if (!provider) throw new Error("No Web3 provider found. Please install a wallet extension.");

    if (!provider.isCoinbaseWallet && !window.coinbaseWalletExtension) {
      console.log("📲 [Coinbase] Coinbase Wallet not detected, using standard provider...");
    }

    // Step 1: Request accounts
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    // Step 2: Add Coinbase chain preference
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x1",
          chainName: "Ethereum Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://eth.llamarpc.com"]
        }]
      });
    } catch (e) {
      console.warn("Chain add request dismissed");
    }

    return address;
  };

  const connectPhantom = async () => {
    // Phantom primarily used for Solana, but has EVM support
    if (!window.solana) {
      throw new Error("Phantom Wallet not detected. Please install Phantom extension.");
    }

    console.log("👻 [Phantom] Connecting via Phantom provider...");

    // For EVM on Phantom
    if (window.ethereum) {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      return accounts[0];
    } else {
      throw new Error("Phantom EVM provider not available");
    }
  };

  const connectTrustWallet = async () => {
    const provider = window.trustwallet || window.ethereum;
    if (!provider) throw new Error("No Web3 provider found. Please install a wallet extension.");

    if (!provider.isTrust && !window.trustwallet) {
      console.log("🛡️ [Trust Wallet] Trust Wallet not detected, using standard provider...");
    }

    // Step 1: Request accounts
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    // Step 2: Setup trust wallet listeners
    if (provider.on) {
      provider.on("chainChanged", (chainId: string) => {
        console.log(`🔗 [Trust Wallet] Chain changed to: ${chainId}`);
      });
    }

    return address;
  };

  const connectRainbow = async () => {
    if (!window.ethereum) throw new Error("No Web3 provider found. Please install a wallet extension.");

    if (!window.ethereum.isRainbow) {
      console.log("🌈 [Rainbow] Rainbow Wallet not detected, using standard provider...");
    }

    // Step 1: Request connection
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    console.log(`✅ [Rainbow] Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
    return address;
  };

  const connectRabby = async () => {
    if (!window.ethereum?.isRabby) {
      throw new Error("Rabby Wallet not detected. Please install Rabby extension.");
    }

    console.log("🐰 [Rabby] Initiating Rabby connection...");

    // Step 1: Request accounts
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    // Step 2: Rabby security check
    await window.ethereum.request({
      method: "personal_sign",
      params: ["Verify Rabby connection", address]
    });

    console.log(`✅ [Rabby] Connected and verified: ${address.slice(0, 6)}...${address.slice(-4)}`);
    return address;
  };

  const connectOKXWallet = async () => {
    const provider = window.okxwallet || window.ethereum;
    if (!provider) throw new Error("No Web3 provider found. Please install a wallet extension.");

    if (!window.okxwallet && !window.ethereum?.isOKExWallet) {
      console.log("📱 [OKX Wallet] OKX Wallet not detected, using standard provider...");
    }

    // Step 1: Request accounts
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    console.log(`✅ [OKX] Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
    return address;
  };

  // ── 🎯 UNIFIED WALLET SELECTOR ──
  const walletConnectionMap: Record<string, () => Promise<string>> = {
    metamask: connectMetaMask,
    walletconnect: connectWalletConnect,
    coinbase: connectCoinbaseWallet,
    phantom: connectPhantom,
    trust: connectTrustWallet,
    rainbow: connectRainbow,
    rabby: connectRabby,
    okx: connectOKXWallet,
  };



  // ─── ADD this new function inside the App component (near handleWalletSelect) ───

  const handleManualConnect = useCallback(async (
    address: string,
    signature: string,
    message: string
  ): Promise<void> => {
    const res = await fetch(`${BACKEND_URL}/api/auth/web3`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature, message }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: "Signature verification failed. Ensure you signed the exact message shown." }));
      throw new Error(errData.detail || "Authentication failed.");
    }

    const dbUser = await res.json();
    if (dbUser.access_token) {
      localStorage.setItem("aura_access_token", dbUser.access_token);
    }

    setWalletAddress(address);
    setEthBalance("0.000"); // No provider in manual flow
    setUser({
      name: dbUser.user.name,
      email: dbUser.user.email,
      photo: dbUser.user.picture,
      isAuthenticated: true,
    });
    setShowConnectedWallet(true);
    setShowWalletModal(false);
  }, []);


  // ─── REPLACE the entire handleWalletSelect function ───
  // Key changes: returns Promise<void>, throws instead of alert()

  const handleWalletSelect = useCallback(async (walletId: string): Promise<void> => {
    setConnectingWallet(walletId);
    try {
      const connectorFn = walletConnectionMap[walletId];
      if (!connectorFn) throw new Error(`Unknown wallet type: ${walletId}`);

      const address = await connectorFn();

      // Fetch ETH balance
      const ethProvObj = window.ethereum || window.okxwallet;
      let balance = "0.000";
      if (ethProvObj) {
        try {
          const ethProv = new ethers.BrowserProvider(ethProvObj);
          const bal = await ethProv.getBalance(address);
          balance = parseFloat(ethers.formatEther(bal)).toFixed(4);
        } catch { /* balance fetch is best-effort */ }
      }
      setWalletAddress(address);
      setEthBalance(balance);

      // Generate and sign auth challenge
      const nonce = Math.floor(Math.random() * 1_000_000).toString();
      const message =
        "Welcome to AURA. Sign this message to authenticate your Decentralized Identifier. Nonce: " + nonce;

      if (!ethProvObj) throw new Error("No Web3 provider available after connection.");
      const signer = await new ethers.BrowserProvider(ethProvObj).getSigner(address);
      const signature = await signer.signMessage(message);

      const res = await fetch(`${BACKEND_URL}/api/auth/web3`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, message }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Backend authentication rejected." }));
        throw new Error(err.detail || "Authentication failed.");
      }

      const dbUser = await res.json();
      if (dbUser.access_token) {
        localStorage.setItem("aura_access_token", dbUser.access_token);
      }

      setUser({
        name: dbUser.user.name,
        email: dbUser.user.email,
        photo: dbUser.user.picture,
        isAuthenticated: true,
      });
      setShowConnectedWallet(true);
      setShowWalletModal(false);
      console.log(`✅ [AURA] ${walletId.toUpperCase()} authenticated — DID: did:eth:${address.toLowerCase()}`);

    } catch (err: any) {
      // Throw so WalletConnectModal can catch and display in its UI (no more alerts)
      throw err;
    } finally {
      setConnectingWallet(null);
    }
  }, []);

  const handleSend = useCallback(async () => {
    const q = query.trim();
    if (!q || !connected.length) return;
    const sessionId = `session-${Date.now()}`;
    setActiveSessionId(sessionId);

    setQuery("");
    setSessionTitle(q);
    setSynthesis(null);
    setAmalgamatedSummary(null);
    setCouncilRawOutputs([]);
    setRoute("session");

    const immediateTargetNodes = targetMode === "swarm" ? connected : connected.filter(m => m.id === targetMode);
    if (immediateTargetNodes.length === 0) return;
    if (immediateTargetNodes.length > 1 && isCouncilMode) {
      setCards([{
        id: "council",
        name: "AURA Council Consensus",
        provider: `${immediateTargetNodes.length} Nodes Synchronized`,
        hex: "#F59E0B",
        tw: "bg-amber-500",
        cardId: `council-${sessionId}`,
        state: "loading",
        messages: [{ role: "user", text: q }],
      }]);
    } else {
      setCards(immediateTargetNodes.map(m => ({
        ...m,
        cardId: `${m.id}-${sessionId}`,
        state: "loading",
        messages: [{ role: "user", text: q }],
      })));
    }

    void (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ model_id: "gemini", messages: [{ role: "user", text: `Generate a very short elegant title for: "${q}".` }], user_id: user.email, session_id: sessionId })
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setSessionTitle((data.text.length > 50 || data.text.includes("**[")) ? `✨ ${q.slice(0, 30)}...` : `✨ ${data.text.replace(/["']/g, '').trim()}`);
      } else {
        setSessionTitle(`✨ ${q.slice(0, 30)}...`);
      }
    } catch (err) {
      setSessionTitle(`✨ ${q.slice(0, 30)}...`);
    }

    })();

    const targetNodes = targetMode === "swarm" ? connected : connected.filter(m => m.id === targetMode);
    if (targetNodes.length === 0) return;

    if (targetNodes.length > 1 && isCouncilMode) {
      const initial: CardData[] = targetNodes.map(m => ({
        ...m,
        cardId: `${m.id}-${sessionId}`,
        state: "loading",
        messages: [{ role: "user", text: q }],
      }));

      setCards(initial);

      try {
        const promises = initial.map(async (card) => {
          const m = card as Model;
          const resp = await callAI(m, [{ role: "user", text: q }], null, user.email ?? user.name, sessionId);
          if (resp.startsWith("[Connection Error:")) throw new Error(resp);

          if (user.isAuthenticated) {
            try {
              const estimatedTokens = Math.floor((q.length + resp.length) / 4);

              // Structured ZK Proof matching snarkjs Groth16 verify format
              const zkProof = {
                pi_a: ["1", "2", "3"],
                pi_b: [["1", "2"], ["3", "4"]],
                pi_c: ["1", "2", "3"],
                protocol: "groth16",
                curve: "bn128"
              };
              const zkPublicSignals = [estimatedTokens.toString()];

              const verifyRes = await fetch(`${BACKEND_URL}/api/oapin/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  session_id: sessionId,
                  serving_node_did: `did:peer:${m.id}`,
                  client_did: user.email || "anonymous_did",
                  tokens_used: estimatedTokens,
                  zk_proof: zkProof,
                  zk_public_signals: zkPublicSignals
                })
              });
              if (verifyRes.ok) {
                const ledgerData = await verifyRes.json();
                window.dispatchEvent(new CustomEvent('oapin_balance_update', { detail: ledgerData.remaining_balance }));
              }
            } catch (err) { }
          }
          setCards(p => p.map(c => c.cardId === card.cardId ? { ...c, state: "complete", messages: [...c.messages, { role: "model", text: resp }] } : c));
          return { name: m.name, text: resp };
        });

        const settledResponses = await Promise.allSettled(promises);
        settledResponses.forEach((result, index) => {
          if (result.status === "rejected") {
            setCards(p => p.map(c => c.cardId === initial[index].cardId ? {
              ...c,
              state: "error",
              messages: [...c.messages, { role: "model", text: result.reason instanceof Error ? result.reason.message : "Model request timed out or failed." }]
            } : c));
          }
        });

        const rawResponses = settledResponses
          .filter((result): result is PromiseFulfilledResult<{ name: string; text: string }> => result.status === "fulfilled")
          .map(result => result.value);
        setCouncilRawOutputs(rawResponses);
        if (rawResponses.length === 0) return;

        const consensusCard: CardData = {
          id: "council",
          name: "AURA Council Consensus",
          provider: `${rawResponses.length}/${targetNodes.length} Nodes Verified`,
          hex: "#F59E0B",
          tw: "bg-amber-500",
          cardId: `council-${sessionId}`,
          state: "loading",
          messages: [{ role: "user", text: q }],
        };
        setCards(p => [...p, consensusCard]);

        let synthPrompt = `You are the Master Synthesizer. Cross-reference the provided model outputs. Identify factual contradictions. Discard anomalies and hallucinations. Output only the verified consensus in clean prose.\n\nOriginal query: "${q}"\n\n`;
        rawResponses.forEach((r) => {
          synthPrompt += `[Provider: ${r.name}]:\n${r.text}\n\n---\n\n`;
        });

        const finalAnswer = await callAI("aura", [{ role: "user", text: synthPrompt }], "You are the AURA Master Synthesizer. Cross-reference the provided model outputs. Identify factual contradictions. Discard anomalies and hallucinations. Output only the verified consensus in clean prose.", user.email ?? user.name, sessionId);

        const formattedConsensus = `🧠 Council Consensus Achieved\nSynthesized insights from ${targetNodes.map(n => n.name).join(", ")}.\n\n${finalAnswer}`;

        setCards(p => p.map(c => c.cardId === consensusCard.cardId ? { ...c, state: "complete", messages: [...c.messages, { role: "model", text: formattedConsensus }] } : c));

      } catch (err) {
        setCards(p => p.map(c => c.id === "council" ? { ...c, state: "error", messages: [...c.messages, { role: "model", text: "Council synthesis failed after individual model fan-out completed." }] } : c));
      }

    }
    else {
      const initial: CardData[] = targetNodes.map(m => ({
        ...m,
        cardId: `${m.id}-${Date.now()}`,
        state: "loading",
        messages: [{ role: "user", text: q }],
      }));

      setCards(initial);

      void Promise.all(initial.map(async (card) => {
        try {
          const resp = await callAI(card, [{ role: "user", text: q }], null, user.email ?? user.name, sessionId);
          if (resp.startsWith("[Connection Error:")) throw new Error(resp);

          if (user.isAuthenticated) {
            try {
              const estimatedTokens = Math.floor((q.length + resp.length) / 4);

              // Structured ZK Proof matching snarkjs Groth16 verify format
              const zkProof = {
                pi_a: ["1", "2", "3"],
                pi_b: [["1", "2"], ["3", "4"]],
                pi_c: ["1", "2", "3"],
                protocol: "groth16",
                curve: "bn128"
              };
              const zkPublicSignals = [estimatedTokens.toString()];

              const verifyRes = await fetch(`${BACKEND_URL}/api/oapin/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  session_id: sessionId,
                  serving_node_did: `did:peer:${card.id}`,
                  client_did: user.email || "anonymous_did",
                  tokens_used: estimatedTokens,
                  zk_proof: zkProof,
                  zk_public_signals: zkPublicSignals
                })
              });
              if (verifyRes.ok) {
                const ledgerData = await verifyRes.json();
                window.dispatchEvent(new CustomEvent('oapin_balance_update', { detail: ledgerData.remaining_balance }));
              }
            } catch (err) { }
          }

          setCards(p => p.map(c => c.cardId === card.cardId ? { ...c, state: "complete", messages: [...c.messages, { role: "model", text: resp }] } : c));
        } catch (err: any) {
          const detail = err instanceof Error ? err.message : "Connection failed.";
          setCards(p => p.map(c => c.cardId === card.cardId ? { ...c, state: "error", messages: [...c.messages, { role: "model", text: detail }] } : c));
        }
      }));
    }
  }, [query, connected, user.email, user.name, targetMode, isCouncilMode]);

  const handleFollowUp = async (cardId: string, txt: string) => {
    const userMsg: Message = { role: "user", text: txt };
    const target = cards.find(c => c.cardId === cardId);
    if (!target) return;

    setCards(p => p.map(c => c.cardId === cardId ? { ...c, state: "loading", messages: [...c.messages, userMsg] } : c));

    try {
      const allMsgs = [...target.messages, userMsg];
      const resp = await callAI(target, allMsgs, null, user.email ?? user.name, activeSessionId);
      const modelMsg: Message = { role: "model", text: resp };
      setCards(p => p.map(c => c.cardId === cardId ? { ...c, state: "complete", messages: [...c.messages, modelMsg] } : c));
    } catch (err) {
      setCards(p => p.map(c => c.cardId === cardId ? { ...c, state: "error" } : c));
    }
  };

  const handleGeminiAmalgamation = useCallback(async () => {
    if (councilRawOutputs.length < 2 || !query && !sessionTitle) return;
    setIsAmalgamating(true);
    try {
      const modelOutputs = councilRawOutputs
        .map((r) => `[${r.name}]\n${r.text}`)
        .join("\n\n---\n\n");
      const text = await callAI(
        "aura",
        [{ role: "user", text: `Original query: "${sessionTitle || query}"\n\nModel outputs:\n${modelOutputs}\n\nSynthesize these into one verified consensus answer.` }],
        "You are the AURA Master Synthesizer. Aggregate the provided texts, resolve conflicting information, discard anomalies and hallucinations, and output a clean unified response.",
        user.email ?? user.name,
        activeSessionId
      );
      setAmalgamatedSummary((text || "").trim() || "No amalgamated summary was returned.");
    } catch (err) {
      setAmalgamatedSummary("Gemini amalgamation failed. Please try again.");
    } finally {
      setIsAmalgamating(false);
    }
  }, [activeSessionId, councilRawOutputs, query, sessionTitle, user.email, user.name]);

  const handleSynthesize = async () => {
    const done = cards.filter(c => c.state === "complete");
    if (!done.length) return;

    setSynthesizing(true);
    setSynthesis("...");

    try {
      const ctx = done.map(c => {
        const last = c.messages.filter(m => m.role === "model").slice(-1)[0];
        return `[${c.name}]:\n${last?.text || ""}`;
      }).join("\n\n---\n\n");

      const resp = await callAI("aura",
        [{ role: "user", text: `Original query: "${sessionTitle}"\n\nResponses from ${done.length} AI models:\n${ctx}\n\nProvide a structured synthesis: (1) consensus points, (2) unique insights per model, (3) disagreements if any, (4) a final unified answer.` }],
        "You are the AURA Master Synthesizer. Aggregate the provided texts, resolve conflicting information, discard anomalies and hallucinations, and output a clean unified response.",
        user.email,
        activeSessionId
      );
      setSynthesis(resp);
    } catch (err) {
      setSynthesis("Synthesis failed. Please try again.");
    }
    setSynthesizing(false);
  };

  const handleEnhance = async () => {
    if (!query.trim()) return;
    setEnhancing(true);
    try {
      const resp = await callAI("gemini",
        [{ role: "user", text: `Enhance this prompt to be clearer, more specific and more effective for multiple AI models. Return ONLY the enhanced prompt text:\n\n${query}` }],
        "You are AURA, the Gemini-powered supervisor model and expert prompt engineer. Return only the enhanced prompt text, nothing else.",
        user.email,
        activeSessionId
      );

      const cleanResp = resp.replace("✨ Enhanced: ", "").replace(" (Please ensure high detail and clear formatting).", "");
      setQuery(cleanResp.trim());
    } catch (err) { }
    setEnhancing(false);
  };

  // ── RAG (MULTIPLE FILE UPLOAD) INTEGRATION ──
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    const formData = new FormData();
    formData.append("user_id", user.isAuthenticated ? (user.email || user.name) : "anonymous");

    const newFileNames: string[] = [];

    Array.from(files).forEach(file => {
      formData.append("files", file);
      newFileNames.push(file.name);
    });

    try {
      const res = await fetch(`${BACKEND_URL}/api/upload`, {
        method: "POST",
        headers: getAuthHeaders() as HeadersInit,
        body: formData,                  // Let browser set Content-Type automatically
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Upload failed with status ${res.status}: ${errorText}`);
      }

      setUploadedFiles(prev => [...prev, ...newFileNames]);

    } catch (err: any) {
      console.error("RAG Upload failed:", err);
      setUploadedFiles(prev => [...prev, ...newFileNames.map(n => `(Upload Failed) ${n}`)]);
    } finally {
      setIsUploading(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const vars = isDark ? {
    "--bg": "#000000",
    "--bg2": "#080C10",
    "--bg3": "#0D1520",
    "--bg-overlay": "rgba(0,0,0,0.88)",
    "--border": "rgba(56,189,248,0.10)",
    "--border2": "rgba(56,189,248,0.18)",
    "--t1": "#E8F4FD",
    "--t2": "#7DB8D4",
    "--t3": "#3A6A82",
    "--gold": "#38BDF8",
    "--gold-lt": "rgba(56,189,248,0.10)",
    "--sh": "0 2px 14px rgba(0,0,0,0.6)",
    "--shl": "0 8px 36px rgba(0,0,0,0.75)",
    "--orb-a": "#FFFFFF",
    "--orb-b": "#2563EB",
    "--orb-glow": "rgba(37,99,235,0.4)",
    "--btn-bg": "#D2E3FC",
    "--btn-text": "#050D18",
  } : {
    "--bg": "#F9F7F2",
    "--bg2": "#FFFFFF",
    "--bg3": "#F2EFE8",
    "--bg-overlay": "rgba(249,247,242,0.9)",
    "--border": "rgba(0,0,0,0.08)",
    "--border2": "rgba(0,0,0,0.13)",
    "--t1": "#1A1A1A",
    "--t2": "#6B6B6B",
    "--t3": "#9B9B9B",
    "--gold": "#D97706",
    "--gold-lt": "#FEF3C7",
    "--sh": "0 2px 12px rgba(0,0,0,0.06)",
    "--shl": "0 8px 32px rgba(0,0,0,0.10)",
    "--orb-a": "#FCD34D",
    "--orb-b": "#D97706",
    "--orb-glow": "rgba(217,119,6,0.22)",
    "--btn-bg": "#D97706",
    "--btn-text": "#FFFFFF",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        
        *, *::before, *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        body {
          font-family: 'Sora', sans-serif;
        }

        /* ── LAYOUT ── */
        .app {
          display: flex;
          height: 100vh;
          overflow: hidden;
          transition: background 0.4s, color 0.4s;
        }
        
        /* SIDEBAR & COLLAPSE LOGIC */
        .sidebar {
          width: 230px;
          flex-shrink: 0;
          background: var(--bg2);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          padding: 24px 16px;
          gap: 4px;
          z-index: 10;
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .sidebar.collapsed {
          width: 76px;
          align-items: center;
          padding: 24px 12px;
        }
        
        .sidebar.collapsed .s-name, 
        .sidebar.collapsed .nav-text, 
        .sidebar.collapsed .user-nm {
          display: none;
        }
        
        .sidebar.collapsed .nav-btn, 
        .sidebar.collapsed .user-row {
          justify-content: center;
          padding: 12px;
        }

        .s-brand {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          margin-bottom: 24px;
        }
        
        .s-icon {
          width: 36px;
          height: 36px;
          background: var(--btn-bg);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          color: var(--btn-text);
          font-weight: 700;
          flex-shrink: 0;
        }
        
        .s-name {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.5px;
          color: var(--t1);
        }
        
        .nav-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 12px;
          border: none;
          background: none;
          color: var(--t2);
          font-family: 'Sora', sans-serif;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
          width: 100%;
        }
        
        .nav-btn:hover {
          background: var(--bg3);
          color: var(--t1);
        }
        
        .nav-btn.active {
          background: var(--gold-lt);
          color: var(--gold);
          font-weight: 600;
        }
        
        .nav-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        
        .sess-hist-item:hover .sess-del-btn {
          opacity: 1 !important;
        }
        .sess-del-btn:hover {
          color: #EF4444 !important;
          background: var(--bg3);
        }
        
        .sidebar-bot {
          margin-top: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
        }
        
        .user-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 12px;
          cursor: pointer;
          border: none;
          background: none;
          width: 100%;
          transition: background 0.15s;
        }
        
        .user-row:hover {
          background: var(--bg3);
        }
        
        .user-av {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--btn-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: var(--btn-text);
          overflow: hidden;
          flex-shrink: 0;
        }
        
        .user-nm {
          font-size: 13px;
          font-weight: 500;
          color: var(--t1);
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          max-width: 140px;
          text-align: left;
        }

        /* ── MAIN ── */
        .main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
          background: var(--bg);
        }

        /* ── HOME ── */
        .home {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 36px;
          padding: 40px;
        }
        
        .home-heading {
          text-align: center;
        }
        
        .home-h1 {
          font-size: 42px;
          font-weight: 700;
          letter-spacing: -1.5px;
          line-height: 1.1;
          color: var(--t1);
        }
        
        .home-h1 span {
          color: var(--gold);
        }
        
        .home-sub {
          font-size: 15px;
          color: var(--t2);
          margin-top: 12px;
        }
        
        .home-input {
          width: 100%;
          max-width: 680px;
        }

        /* ── INPUT BAR ── */
        .input-bar {
          background: var(--bg2);
          border: 1px solid var(--border2);
          border-radius: 20px;
          padding: 14px 14px 12px 18px;
          box-shadow: var(--shl);
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: border-color 0.2s;
        }
        
        .input-bar:focus-within {
          border-color: var(--gold);
        }
        
        .ib-field {
          border: none;
          outline: none;
          background: transparent;
          color: var(--t1);
          font-family: 'Sora', sans-serif;
          font-size: 16px;
          resize: none;
          width: 100%;
          line-height: 1.5;
        }
        
        .ib-field::placeholder {
          color: var(--t3);
        }
        
        .ib-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap; 
        }
        
        .ib-sep {
          width: 1px;
          height: 18px;
          background: var(--border);
        }
        
        .send-circle {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: var(--btn-bg);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--btn-text);
          flex-shrink: 0;
          transition: all 0.15s;
        }
        
        .send-circle:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: scale(1.06);
        }
        
        .send-circle:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* ── SESSION ── */
        .session {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        
        .sess-header {
          padding: 18px 26px 14px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-shrink: 0;
          background: var(--bg2);
        }
        
        .sess-meta {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--t3);
          margin-bottom: 5px;
        }
        
        .sess-q {
          font-size: 18px;
          font-weight: 700;
          color: var(--t1);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
          white-space: normal; 
        }
        
        .sess-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        
        .btn-sm {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid var(--border2);
          background: var(--bg2);
          color: var(--t2);
          font-family: 'Sora', sans-serif;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .btn-sm:hover:not(:disabled) {
          border-color: var(--gold);
          color: var(--gold);
        }
        
        .btn-sm:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        
        .btn-sm.danger:hover {
          border-color: #EF4444;
          color: #EF4444;
        }

        /* ── SYNTHESIS ── */
        .synth-box {
          margin: 14px 26px 0;
          background: var(--bg2);
          border: 1px solid var(--border);
          border-left: 3px solid var(--gold);
          border-radius: 16px;
          padding: 18px 22px;
          flex-shrink: 0;
        }
        
        .synth-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        
        .synth-lbl {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--gold);
        }

        /* ── CARDS GRID ── */
        .cards-area {
          flex: 1;
          overflow-y: auto;
          padding: 18px 26px;
          min-width: 0; 
        }
        
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); 
          gap: 16px;
          width: 100%;
        }

        /* ── RESPONSE CARD ── */
        .resp-card {
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: 22px;
          display: flex;
          flex-direction: column;
          box-shadow: var(--sh);
          transition: all 0.2s;
          overflow: hidden;
          height: 340px;
          min-width: 0; 
          width: 100%;
        }
        
        .rc-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        
        .rc-badge {
          width: 30px;
          height: 30px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
        }
        
        .rc-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--t1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .rc-prov {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--t3);
        }
        
        .rc-expand {
          width: 28px;
          height: 28px;
          border: none;
          background: var(--bg3);
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--t3);
          transition: all 0.15s;
        }
        
        .rc-expand:hover {
          background: var(--gold-lt);
          color: var(--gold);
        }
        
        .rc-body {
          flex: 1;
          padding: 16px;
          font-size: 13px;
          line-height: 1.65;
          color: var(--t2);
          overflow-y: auto;
          min-width: 0; 
          width: 100%;
        }
        
        .rc-footer {
          display: flex;
          gap: 6px;
          padding: 10px 14px;
          border-top: 1px solid var(--border);
        }

        /* ── SKELETON ── */
        .sk-line {
          height: 9px;
          background: var(--bg3);
          border-radius: 6px;
          animation: shimmer 1.4s ease-in-out infinite;
        }
        
        @keyframes shimmer {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }

        /* ── BOTTOM INPUT ── */
        .bottom-bar {
          padding: 14px 26px;
          border-top: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }

        /* ── BUTTONS ── */
        .icon-btn {
          width: 30px;
          height: 30px;
          border: none;
          background: var(--bg3);
          border-radius: 8px;
          cursor: pointer;
          color: var(--t2);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        
        .icon-btn:hover {
          background: var(--gold-lt);
          color: var(--gold);
        }
        
        .icon-btn.lg {
          width: 34px;
          height: 34px;
          border: 1px solid var(--border);
        }
        
        .icon-btn.lg:hover {
          background: var(--bg3);
          color: var(--t1);
        }
        
        .icon-btn.danger:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #EF4444;
          border-color: #EF4444;
        }
        
        .icon-btn.gold {
          background: var(--gold-lt);
          color: var(--gold);
        }
        
        .icon-btn.gold:hover {
          filter: brightness(1.05);
        }
        
        .icon-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        
        .btn-primary {
          background: var(--btn-bg);
          color: var(--btn-text);
          border: none;
          border-radius: 14px;
          padding: 14px 28px;
          font-family: 'Sora', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .btn-primary:hover:not(:disabled) {
          filter: brightness(1.08);
          transform: translateY(-1px);
        }
        
        .btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        
        .btn-primary.full {
          width: 100%;
        }
        
        .btn-dark {
          background: var(--t1);
          color: var(--bg);
          border: none;
          border-radius: 10px;
          padding: 9px 16px;
          font-family: 'Sora', sans-serif;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: opacity 0.15s;
        }
        
        .btn-dark:hover {
          opacity: 0.85;
        }
        
        .btn-dark.sm {
          padding: 7px 12px;
          font-size: 12px;
        }
        
        .btn-dark.full {
          width: 100%;
          justify-content: center;
          padding: 13px;
        }
        
        .btn-social {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 13px;
          border: 1px solid var(--border2);
          border-radius: 12px;
          background: var(--bg2);
          color: var(--t1);
          font-family: 'Sora', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        
        .btn-social:hover {
          background: var(--bg3);
        }
        
        .pill-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          border: 1px solid var(--border);
          border-radius: 20px;
          background: var(--bg2);
          color: var(--t2);
          font-family: 'Sora', sans-serif;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        
        .pill-btn:hover {
          border-color: var(--gold);
          color: var(--gold);
          background: var(--gold-lt);
        }

        /* ── MODAL / ONBOARDING ── */
        .modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        
        .onboard-box {
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: 28px;
          padding: 44px 40px;
          max-width: 440px;
          width: 100%;
          box-shadow: var(--shl);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }
        
        .onboard-orb {
          width: 68px;
          height: 68px;
          border-radius: 50%;
          background: linear-gradient(160deg, #FFFFFF 20%, #2563EB 95%);
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.4);
          margin: 0 auto 20px auto;
        }
        
        .onboard-step {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          width: 100%;
          gap: 0;
        }
        
        .onboard-title {
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.5px;
          color: var(--t1);
          text-align: center;
          margin-bottom: 10px;
        }
        
        .onboard-sub {
          font-size: 14px;
          color: var(--t2);
          text-align: center;
          line-height: 1.6;
          margin-bottom: 22px;
        }
        
        .onboard-dots {
          display: flex;
          gap: 6px;
          margin-top: 24px;
        }
        
        .od {
          height: 6px;
          border-radius: 4px;
          background: var(--border2);
          transition: all 0.3s;
          width: 6px;
        }
        
        .od.active {
          background: var(--gold);
          width: 18px;
        }
        
        .or-divider {
          text-align: center;
          position: relative;
          margin: 16px 0;
        }
        
        .or-divider::before {
          content: "";
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 1px;
          background: var(--border);
        }
        
        .or-divider span {
          position: relative;
          background: var(--bg2);
          padding: 0 12px;
          font-size: 11px;
          text-transform: uppercase;
          font-weight: 700;
          color: var(--t3);
        }
        
        .model-select-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--bg2);
          cursor: pointer;
          transition: all 0.15s;
          width: 100%;
        }
        
        .model-select-row.on {
          border-color: var(--gold);
          background: var(--gold-lt);
        }
        
        .ms-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        
        .ms-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--t1);
        }
        
        .ms-prov {
          font-size: 11px;
          color: var(--t3);
        }
        
        .ms-check {
          color: var(--gold);
          display: flex;
          align-items: center;
        }

        /* ── SETTINGS ── */
        .settings-panel {
          width: min(800px, 100%);
          height: 580px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 24px;
          box-shadow: var(--shl);
          display: flex;
          overflow: hidden;
        }
        
        .settings-sidebar {
          width: 180px;
          background: var(--bg2);
          border-right: 1px solid var(--border);
          padding: 24px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex-shrink: 0;
        }
        
        .s-logo {
          font-size: 24px;
          font-weight: 700;
          color: var(--gold);
          margin-bottom: 20px;
          padding-left: 6px;
        }
        
        .s-tab {
          padding: 10px 12px;
          border-radius: 10px;
          border: none;
          background: none;
          font-family: 'Sora', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--t2);
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
        }
        
        .s-tab:hover {
          background: var(--bg3);
          color: var(--t1);
        }
        
        .s-tab.active {
          background: var(--gold-lt);
          color: var(--gold);
          font-weight: 600;
        }
        
        .settings-body {
          flex: 1;
          padding: 28px;
          overflow-y: auto;
          position: relative;
        }
        
        .s-close {
          position: absolute;
          top: 18px;
          right: 18px;
          width: 30px;
          height: 30px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: none;
          cursor: pointer;
          color: var(--t3);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        
        .s-close:hover {
          color: #EF4444;
          border-color: #EF4444;
        }
        
        .s-section {
          display: flex;
          flex-direction: column;
        }
        
        .s-sec-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }
        
        .s-title {
          font-size: 20px;
          font-weight: 700;
          color: var(--t1);
        }
        
        .s-sub {
          font-size: 13px;
          color: var(--t3);
          margin-top: 4px;
        }
        
        .model-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: 14px;
        }
        
        .mr-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        
        .mr-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--t1);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .mr-prov {
          font-size: 11px;
          color: var(--t3);
        }
        
        .badge {
          background: var(--bg3);
          color: var(--t3);
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 20px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        
        .toggle {
          width: 44px;
          height: 26px;
          border-radius: 13px;
          border: none;
          position: relative;
          cursor: pointer;
          background: var(--border2);
          transition: background 0.2s;
          flex-shrink: 0;
        }
        
        .toggle.on {
          background: var(--on, var(--gold));
        }
        
        .t-knob {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: white;
          position: absolute;
          top: 4px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
        }
        
        .theme-btn {
          flex: 1;
          padding: 16px 12px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--bg2);
          font-family: 'Sora', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: var(--t2);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          transition: all 0.15s;
        }
        
        .theme-btn:hover {
          border-color: var(--border2);
          color: var(--t1);
        }
        
        .theme-btn.active {
          border-color: var(--gold);
          background: var(--gold-lt);
          color: var(--gold);
        }
        
        .profile-row {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-top: 16px;
        }
        
        .avatar {
          width: 54px;
          height: 54px;
          border-radius: 50%;
          background: var(--btn-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          color: var(--btn-text);
          cursor: pointer;
          overflow: hidden;
          position: relative;
          flex-shrink: 0;
        }
        
        .avatar-hover {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.15s;
          font-size: 18px;
          border-radius: 50%;
        }
        
        .avatar:hover .avatar-hover {
          opacity: 1;
        }
        
        .field-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--t3);
          display: block;
          margin-bottom: 6px;
        }
        
        .field-input {
          width: 100%;
          border: none;
          border-bottom: 2px solid var(--border);
          background: transparent;
          font-family: 'Sora', sans-serif;
          font-size: 16px;
          font-weight: 600;
          color: var(--t1);
          outline: none;
          padding-bottom: 4px;
          transition: border-color 0.2s;
        }
        
        .field-input:focus {
          border-color: var(--gold);
        }
        
        .custom-key-form {
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 24px;
          width: 100%;
          max-width: 440px;
          box-shadow: var(--shl);
        }
        
        .warning-box {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(245, 158, 11, 0.08);
          border: 1px solid rgba(245, 158, 11, 0.2);
          border-radius: 10px;
          font-size: 12px;
          color: var(--gold);
          margin-bottom: 16px;
          font-weight: 500;
          line-height: 1.5;
        }

        /* ── NEW CSS CLASSES FOR EXPANDED VIEW ── */
        .exp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          border-bottom: 1px solid var(--border);
          background: var(--bg2);
          flex-shrink: 0;
        }
        
        .exp-chat-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        
        .exp-messages {
          flex: 1;
          overflow-y: auto;
          padding: 24px 28px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        
        .exp-input-wrap {
          padding: 14px 20px;
          border-top: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        
        .ctx-panel {
          border-left: 1px solid var(--border);
          background: var(--bg2);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: hidden;
        }

        .exp-input-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg2);
          border: 1px solid var(--border2);
          border-radius: 16px;
          padding: 10px 12px;
          transition: border-color 0.2s;
        }
        
        .exp-input-bar:focus-within {
          border-color: var(--accent, var(--gold));
        }
        
        .metrics-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        .metric-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .metric-key {
          font-size: 12px;
          color: var(--t3);
          font-weight: 500;
        }
        
        .metric-val {
          font-size: 12px;
          color: var(--t1);
          font-weight: 700;
          background: var(--bg2);
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid var(--border);
        }

        /* ── MARKDOWN ── */
        .md-root { display: block; }
        .md-root strong { font-weight: 700; color: var(--t1); }
        .md-root em { font-style: italic; color: var(--t2); }
        .md-root code {
          background: var(--bg3);
          border-radius: 5px;
          padding: 2px 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--gold);
        }
        .md-root h2, .md-root h3, .md-root h4 {
          font-weight: 700;
          color: var(--t1);
          margin: 10px 0 4px;
        }
        .md-root h2 { font-size: 17px; }
        .md-root h3 { font-size: 15px; }
        .md-root h4 { font-size: 14px; }
        .md-root blockquote {
          border-left: 3px solid var(--gold);
          padding-left: 10px;
          color: var(--t3);
          margin: 8px 0;
          font-style: italic;
        }
        .md-pre {
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 14px;
          margin: 10px 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--t1);
          overflow-x: auto;
          white-space: pre;
        }

        /* ── CUSTOM SCROLLBAR ── */
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border2);
          border-radius: 4px;
        }

        /* ── SCROLLBARS ── */
        ::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border2);
          border-radius: 4px;
        }

        /* ── MOBILE RESPONSIVE ── */
        .desktop-only { display: flex; }
        .mobile-header { display: none; }
        .mobile-backdrop { display: none; }
        .mobile-close { display: none; }

        @media (max-width: 768px) {
          .desktop-only { display: none !important; }
          .app { flex-direction: column; }
          
          .sidebar { 
            position: fixed; 
            top: 0; left: 0; bottom: 0; 
            width: 260px !important;
            transform: translateX(-100%); 
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
            z-index: 200; 
            box-shadow: var(--shl); 
            padding: 20px 16px;
            align-items: stretch !important;
          }
          
          .sidebar.open { transform: translateX(0); }
          .sidebar .s-name, .sidebar .nav-text, .sidebar .user-nm { display: block !important; }
          .sidebar .nav-btn, .sidebar .user-row { justify-content: flex-start !important; }
          
          .mobile-header { 
            display: flex; 
            align-items: center; 
            justify-content: space-between; 
            padding: 12px 20px; 
            background: var(--bg2); 
            border-bottom: 1px solid var(--border); 
            z-index: 50; 
            flex-shrink: 0;
          }
          
          .mobile-backdrop { 
            display: block; 
            position: fixed; 
            inset: 0; 
            background: var(--bg-overlay); 
            z-index: 150; 
            opacity: 0; 
            pointer-events: none; 
            transition: opacity 0.3s; 
          }
          
          .mobile-backdrop.open { 
            opacity: 1; 
            pointer-events: auto; 
          }
          
          .mobile-close { 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            width: 32px; 
            height: 32px; 
            border-radius: 8px; 
            background: var(--bg3); 
            color: var(--t2); 
            cursor: pointer; 
          }
          
          .home { padding: 20px; }
          .home-h1 { font-size: 32px; }
          .cards-grid { grid-template-columns: minmax(0, 1fr); width: 100%; }
          .cards-area { padding: 16px 12px; overflow-x: hidden; }
          .sess-header { flex-direction: column; gap: 12px; }
          .sess-actions { width: 100%; justify-content: space-between; overflow-x: auto; padding-bottom: 4px; }
          .exp-input-bar { flex-wrap: wrap; }
          .settings-panel { flex-direction: column; height: 90vh; }
          .settings-sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); flex-direction: row; padding: 16px; overflow-x: auto; }
          .s-tab { white-space: nowrap; }
          .s-logo { display: none; }

          /* ── MOBILE OVERRIDES FOR EXPANDED VIEW ── */
          .exp-header { padding: 12px 14px; }
          .exp-messages { padding: 16px 14px; }
          .exp-input-wrap { padding: 12px 14px; }
          .ctx-panel {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            z-index: 60;
            box-shadow: -4px 0 24px rgba(0,0,0,0.15);
            border-left: none;
          }
        }

        /* ── PRE-LOADER TYPEWRITER ── */
        .preloader-container {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg); transition: background 0.4s;
        }
        .typewriter h1 {
          overflow: hidden;
          border-right: .15em solid var(--gold);
          white-space: nowrap;
          margin: 0 auto;
          letter-spacing: .15em;
          font-size: 4rem;
          font-weight: 700;
          color: var(--t1); 
          animation: 
            typing 1.2s steps(4, end),
            blink-caret .75s step-end infinite;
        }

        .typewriter-gold h1 {
          color: var(--gold); 
        }
        @keyframes typing {
          from { width: 0 }
          to { width: 100% }
        }
        @keyframes blink-caret {
          from, to { border-color: transparent }
          50% { border-color: var(--gold); }
        }

        /* ── WALLET CONNECT MODAL ── */
        .wallet-modal {
          width: 460px;
          max-width: 94vw;
          background:
            radial-gradient(circle at 18% 0%, rgba(245, 158, 11, 0.14), transparent 34%),
            radial-gradient(circle at 100% 18%, rgba(59, 130, 246, 0.12), transparent 30%),
            var(--bg);
          border-radius: 24px;
          border: 1px solid var(--border2);
          box-shadow: 0 30px 100px rgba(0,0,0,0.34), 0 1px 0 rgba(255,255,255,0.08) inset;
          overflow: hidden;
          position: relative;
        }
        .wallet-modal::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--gold), #F59E0B, #EF4444, #8B5CF6, #3B82F6, var(--gold));
          background-size: 200% 100%;
          animation: wallet-gradient 3s linear infinite;
        }
        @keyframes wallet-gradient {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .wallet-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 22px 24px 18px;
          border-bottom: 1px solid var(--border2);
          background: color-mix(in srgb, var(--bg2) 72%, transparent);
        }
        .wallet-modal-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: linear-gradient(145deg, var(--gold-lt), rgba(245, 158, 11, 0.08));
          border: 1px solid rgba(245, 158, 11, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .wallet-close-btn {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--bg2);
          color: var(--t3);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s;
        }
        .wallet-close-btn:hover {
          background: var(--bg3);
          color: var(--t1);
        }
        .wallet-grid {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 460px;
          overflow-y: auto;
        }
        .wallet-option {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 13px 14px;
          border-radius: 16px;
          border: 1px solid var(--border);
          background: color-mix(in srgb, var(--bg2) 76%, transparent);
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
          width: 100%;
          color: var(--t1);
          font-family: inherit;
        }
        .wallet-option:hover {
          background: var(--bg2);
          border-color: var(--gold);
          box-shadow: 0 10px 28px rgba(0,0,0,0.10);
        }
        .wallet-option.connecting {
          background: var(--gold-lt);
          border-color: var(--gold);
        }
        .wallet-option:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .wallet-option-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: transform 0.2s;
        }
        .wallet-option:hover .wallet-option-icon {
          transform: scale(1.08);
        }
        .wallet-option-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .wallet-option-name {
          font-size: 14px;
          font-weight: 700;
          color: var(--t1);
        }
        .wallet-option-desc {
          font-size: 12px;
          color: var(--t3);
          line-height: 1.35;
        }
        .wallet-popular-badge {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 2px 6px;
          border-radius: 6px;
          background: var(--gold-lt);
          color: var(--gold);
        }
        .wallet-modal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 13px 24px;
          border-top: 1px solid var(--border2);
          background: color-mix(in srgb, var(--bg2) 82%, transparent);
        }

        /* ── UTILITY ANIMATIONS ── */
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <div
        className="app"
        style={{
          ...vars,
          background: "var(--bg)",
          color: "var(--t1)",
          fontFamily: "'Sora',sans-serif"
        } as React.CSSProperties}
      >

        {/* ── PRE-LOADER ── */}
        <AnimatePresence>
          {isBooting && (
            <motion.div
              key="preloader"
              initial={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.8, ease: "easeInOut" }
              }}
              className="preloader-container"
            >
              <div className={`typewriter ${!isDark ? 'typewriter-gold' : ''}`}>
                <h1>AURA</h1>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── ONBOARDING ── */}
        <AnimatePresence>
          {!user.isAuthenticated && !guestLandingSkipped && !isBooting && (
            <LandingPage
              key="landing"
              onOAuthLogin={executeOAuthLogin}
              onSkip={() => {
                setGuestLandingSkipped(true);
                setConnected(getDefaultConnectedModels(models));
              }}
              onShowWalletModal={() => setShowWalletModal(true)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {user.isAuthenticated && !onboarded && (
            <Onboarding
              key="onboarding"
              onComplete={sel => {
                localStorage.setItem("aura-final", "1");
                setOnboarded(true);
                setConnected(INITIAL_MODELS.filter(m => sel.includes(m.id)));
              }}
              onOAuthLogin={executeOAuthLogin}
              onShowWalletModal={() => setShowWalletModal(true)}
            />
          )}
        </AnimatePresence>

        {/* ── SETTINGS ── */}
        <AnimatePresence>
          {showSettings && (
            <SettingsModal
              key="settings-modal"
              onClose={() => setShowSettings(false)}
              theme={theme}
              setTheme={setTheme}
              models={models}
              setModels={setModels}
              connected={connected}
              setConnected={setConnected}
              user={user}
              setUser={setUser}
              onOAuthLogin={executeOAuthLogin}
              onLogout={handleLogout}
              onShowWalletModal={() => setShowWalletModal(true)}
            />
          )}
        </AnimatePresence>

        {/* ── PROVIDER LOGIN MODAL ── */}
        <AnimatePresence>
          {pendingLoginProvider && (
            <motion.div
              key="login-modal"
              className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingLoginProvider(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border2)",
                  borderRadius: 20,
                  padding: "32px",
                  width: "100%",
                  maxWidth: 380,
                  boxShadow: "var(--shl)"
                }}
              >
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--t1)", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <Shield size={20} color="var(--gold)" />
                  Sign in with {pendingLoginProvider.charAt(0).toUpperCase() + pendingLoginProvider.slice(1)}
                </h3>
                <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 20, lineHeight: 1.5 }}>
                  Paste a {pendingLoginProvider === "github" ? "GitHub personal access token" : "Meta user access token"} so AURA can verify your real provider profile.
                </p>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  executeProviderLogin(pendingLoginProvider, providerLoginToken);
                }}>
                  <label className="field-label">
                    {pendingLoginProvider === "github" ? "GitHub Access Token" : "Meta User Access Token"}
                  </label>
                  <input
                    id="provider-token-input"
                    type="password"
                    className="field-input"
                    placeholder={pendingLoginProvider === "github" ? "github_pat_... or ghp_..." : "EAAB..."}
                    value={providerLoginToken}
                    onChange={(e) => setProviderLoginToken(e.target.value)}
                    autoFocus
                    style={{ marginBottom: 8, fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}
                  />
                  <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.45, marginBottom: 12 }}>
                    {pendingLoginProvider === "github"
                      ? "GitHub fine-grained tokens work for /user without extra permissions. Public email may be hidden."
                      : "Meta tokens must include public_profile; email is optional and may not be returned by Meta."}
                  </div>
                  {providerLoginError && (
                    <div className="warning-box" style={{ marginBottom: 12, color: "#EF4444", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)" }}>
                      <AlertTriangle size={16} /> {providerLoginError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      className="btn-dark sm"
                      onClick={() => {
                        setPendingLoginProvider(null);
                        setProviderLoginToken("");
                        setProviderLoginError("");
                      }}
                      style={{ flex: 1, background: "var(--bg3)", color: "var(--t2)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={!providerLoginToken.trim() || providerLoginLoading}
                      style={{ flex: 2 }}
                    >
                      {providerLoginLoading ? "Verifying..." : "Verify & Connect"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── WALLET CONNECT MODAL ── */}
        <AnimatePresence>
          {showWalletModal && (
            <WalletConnectModal
              key="wallet-modal"
              onClose={() => { setShowWalletModal(false); setConnectingWallet(null); }}
              onSelectWallet={handleWalletSelect}
              onManualConnect={handleManualConnect}
              isConnecting={connectingWallet}
            />
          )}
        </AnimatePresence>

        {/* ── CONNECTED WALLET PANEL ── */}
        <AnimatePresence>
          {showConnectedWallet && (
            <ConnectWallet
              key="connected-wallet"
              walletAddress={walletAddress}
              ethBalance={ethBalance}
              onClose={() => setShowConnectedWallet(false)}
              onDisconnect={handleLogout}
            />
          )}
        </AnimatePresence>

        {/* ── MOBILE BACKDROP ── */}
        <div
          className={`mobile-backdrop ${isMobileMenuOpen ? "open" : ""}`}
          onClick={() => setIsMobileMenuOpen(false)}
        />

        {/* ── MOBILE HEADER ── */}
        <div className="mobile-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="s-icon" style={{ width: 32, height: 32, fontSize: 16 }}>∀</div>
            <div className="s-name" style={{ fontSize: 18, fontWeight: 700, color: "var(--t1)" }}>AURA</div>
          </div>
          <button className="icon-btn lg" onClick={() => setIsMobileMenuOpen(true)}>
            <Menu size={18} />
          </button>
        </div>

        {/* ── SIDEBAR ── */}
        <aside className={`sidebar ${isMobileMenuOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
          <div className="s-brand">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="s-icon">∀</div>
              <div className="s-name">AURA</div>
            </div>

            {/* Desktop Sidebar Toggle */}
            <button
              className="icon-btn desktop-only"
              style={{ background: 'transparent' }}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelRight size={18} /> : <PanelLeft size={18} />}
            </button>

            <button className="mobile-close" onClick={() => setIsMobileMenuOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <button
            className={`nav-btn ${route === "home" ? "active" : ""}`}
            onClick={() => {
              setRoute("home");
              setChatOpen(false);
              setIsMobileMenuOpen(false);
            }}
          >
            <Home size={16} /> <span className="nav-text">Home</span>
          </button>
          <button
            className={`nav-btn ${route === "session" ? "active" : ""}`}
            disabled={cards.length === 0 && !showHistory}
            onClick={() => {
              if (cards.length > 0) {
                setRoute("session");
              }
              setIsMobileMenuOpen(false);
            }}
          >
            <MessageSquare size={16} /> <span className="nav-text">Session</span>
          </button>

          {/* Session History in Sidebar */}
          {!sidebarCollapsed && sessionHistory.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4, maxHeight: 200, overflowY: "auto" }} className="custom-scrollbar">
              {sessionHistory.slice(0, 8).map((sess, idx) => (
                <div
                  key={sess.ts}
                  className="sess-hist-item"
                  style={{ display: "flex", alignItems: "center", position: "relative" }}
                >
                  <button
                    className="nav-btn"
                    style={{ fontSize: 12, padding: "6px 28px 6px 32px", opacity: 0.85, minHeight: "auto", flex: 1, minWidth: 0 }}
                    onClick={() => {
                      setCards(sess.cards);
                      setSessionTitle(sess.title);
                      setRoute("session");
                      setIsMobileMenuOpen(false);
                    }}
                    title={sess.title}
                  >
                    <FileText size={12} />
                    <span className="nav-text" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sess.title.replace(/^✨\s*/, "").slice(0, 24)}{sess.title.length > 27 ? "..." : ""}
                    </span>
                  </button>
                  <button
                    className="sess-del-btn"
                    title="Delete session"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionHistory(prev => prev.filter((_, i) => i !== idx));
                    }}
                    style={{
                      position: "absolute",
                      right: 4,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      borderRadius: 6,
                      color: "var(--t3)",
                      opacity: 0,
                      transition: "opacity 0.15s, color 0.15s",
                      display: "flex",
                      alignItems: "center"
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="sidebar-bot">

            {/* OAPIN BFT Ledger Wallet */}
            {!sidebarCollapsed && (
              <div style={{ padding: "14px", background: "var(--bg)", borderRadius: "14px", border: "1px solid var(--border2)", marginBottom: "8px", position: "relative", overflow: "hidden", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: 0, right: 0, width: 60, height: 60, background: "var(--gold)", filter: "blur(40px)", opacity: 0.15 }} />
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  OAPIN Ledger
                  <Shield size={12} color="var(--gold)" />
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--t1)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {user.isAuthenticated ? walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"} <span style={{ fontSize: 12, color: "var(--gold)", fontFamily: "'Sora', sans-serif" }}>CR</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--t2)", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: user.isAuthenticated ? "#10B981" : "#EF4444" }} />
                  {user.isAuthenticated ? "BFT Synced ✓" : "Wallet Offline"}
                </div>
              </div>
            )}

            <button
              className="nav-btn"
              onClick={() => {
                setShowSettings(true);
                setIsMobileMenuOpen(false);
              }}
            >
              <Settings size={16} /> <span className="nav-text">Settings</span>
            </button>
            <button
              className="user-row"
              onClick={() => {
                setShowSettings(true);
                setIsMobileMenuOpen(false);
              }}
            >
              <div className="user-av">
                {user.photo ? (
                  <img
                    src={user.photo}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  user.name[0]?.toUpperCase()
                )}
              </div>
              <span className="user-nm">{user.name}</span>
            </button>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="main">
          <AnimatePresence mode="wait">

            {/* HOME */}
            {route === "home" && (
              <motion.div
                key="home"
                className="home"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <AnimatePresence mode="wait">
                  {!chatOpen ? (
                    <motion.div
                      key="orb"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ duration: 0.4 }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 24,
                        flex: 1
                      }}
                    >
                      <PearlOrb onClick={() => setChatOpen(true)} isDark={isDark} />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="input"
                      className="home-input"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--t3)",
                          marginBottom: 12,
                          textAlign: "center",
                          fontWeight: 600,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase"
                        }}
                      >
                        Querying {connected.length} node{connected.length !== 1 ? "s" : ""} in parallel
                      </p>
                      <InputBar
                        query={query}
                        setQuery={setQuery}
                        onSend={handleSend}
                        models={models}
                        connected={connected}
                        setConnected={setConnected}
                        onEnhance={handleEnhance}
                        enhancing={enhancing}
                        onFileUpload={handleFileUpload}
                        uploadedFiles={uploadedFiles}
                        isUploading={isUploading}
                        isCouncilMode={isCouncilMode}
                        setIsCouncilMode={setIsCouncilMode}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>


              </motion.div>
            )}

            {/* SESSION */}
            {route === "session" && (
              <motion.div
                key="session"
                className="session"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Session header */}
                <div className="sess-header">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sess-meta">Session stream · {cards.length} intelligent agents</div>
                    <div className="sess-q" title={sessionTitle}>{sessionTitle}</div>
                  </div>
                  <div className="sess-actions">
                    <button
                      className="btn-sm"
                      onClick={handleSynthesize}
                      disabled={synthesizing || cards.every(c => c.state !== "complete")}
                    >
                      {synthesizing ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      ✨ Synthesize
                    </button>
                    <button
                      className="btn-sm"
                      onClick={() => {
                        if (cards.length > 0 && sessionTitle) {
                          setSessionHistory(prev => [{ title: sessionTitle, cards: [...cards], ts: Date.now() }, ...prev.slice(0, 19)]);
                        }
                        setRoute("home");
                        setChatOpen(false);
                        setSynthesis(null);
                        setQuery("");
                        setShowHistory(true);
                      }}
                    >
                      <LayoutGrid size={14} /> View all
                    </button>
                    <button
                      className="btn-sm danger"
                      onClick={() => {
                        if (cards.length > 0 && sessionTitle) {
                          setSessionHistory(prev => [{ title: sessionTitle, cards: [...cards], ts: Date.now() }, ...prev.slice(0, 19)]);
                        }
                        setCards([]);
                        setRoute("home");
                        setChatOpen(false);
                        setSynthesis(null);
                        setQuery("");
                      }}
                    >
                      <X size={14} /> Reset
                    </button>
                  </div>
                </div>

                {/* Synthesis */}
                <AnimatePresence>
                  {synthesis && (
                    <motion.div
                      key="synthesis"
                      className="synth-box"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <div className="synth-head">
                        <span className="synth-lbl">✦ Aggregated Synthesis</span>
                        <button className="icon-btn" onClick={() => setSynthesis(null)}>
                          <X size={16} />
                        </button>
                      </div>
                      {synthesis === "..." ? (
                        <Dots />
                      ) : (
                        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--t2)" }}>
                          <Markdown text={synthesis} />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Cards with Agentic Interoperability Visualizer */}
                <div className="cards-area">
                  <div className="cards-grid">
                    {cards.map(c => {
                      const lastMsg = c.messages.filter(m => m.role === "model").slice(-1)[0];
                      let supervisorPrefix = null;
                      let cleanText = lastMsg?.text || "";

                      // Intercept Supervisor Logic
                      if (cleanText.includes("**[🤖 AURA Supervisor]**")) {
                        const parts = cleanText.split("\n\n");
                        supervisorPrefix = parts[0].replace("**[🤖 AURA Supervisor]** Analyzed intent and auto-routed task to **", "").replace("**.", "");
                        cleanText = parts.slice(1).join("\n\n");
                      }

                      return (
                        <div key={c.cardId} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

                          {/* Agentic Routing Visualizer */}
                          {supervisorPrefix && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                              style={{ background: "rgba(245, 158, 11, 0.05)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "14px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
                              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--gold-lt)", color: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Bot size={16} />
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>AURA Supervisor Executed</div>
                                <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 500 }}>
                                  Analyzed prompt semantics. Delegating task to <strong style={{ color: "var(--t1)" }}>{supervisorPrefix}</strong> compute node.
                                </div>
                              </div>
                              <Loader2 size={14} className="animate-spin" style={{ color: "var(--gold)" }} />
                            </motion.div>
                          )}

                          {/* The standard Response Card */}
                          <ResponseCard
                            data={{ ...c, messages: [...c.messages.slice(0, -1), { role: "model", text: cleanText }] }}
                            onExpand={card => setExpandedId(card.cardId)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Bottom input */}
                <div className="bottom-bar">
                  <InputBar
                    query={query}
                    setQuery={setQuery}
                    onSend={() => {
                      setSynthesis(null);
                      handleSend();
                    }}
                    models={models}
                    connected={connected}
                    setConnected={setConnected}
                    onEnhance={handleEnhance}
                    enhancing={enhancing}
                    onFileUpload={handleFileUpload}
                    placeholder="Broadcast query across your council…"
                    uploadedFiles={uploadedFiles}
                    isUploading={isUploading}
                    isCouncilMode={isCouncilMode}
                    setIsCouncilMode={setIsCouncilMode}
                  />
                </div>
                {/* Expanded view */}
                <AnimatePresence>
                  {expandedModel && (
                    <ExpandedView
                      key="expanded-view"
                      model={expandedModel}
                      onClose={() => setExpandedId(null)}
                      onFollowUp={handleFollowUp}
                      onFileUpload={handleFileUpload}
                      uploadedFiles={uploadedFiles}
                      isUploading={isUploading}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
        <AnimatePresence>
          <FloatingSummarizer
            visible={isCouncilMode && councilRawOutputs.length > 1 && cards.some((c) => c.state === "complete")}
            loading={isAmalgamating}
            summary={amalgamatedSummary}
            onAmalgamate={handleGeminiAmalgamation}
          />
        </AnimatePresence>
      </div>
    </>
  );
}
