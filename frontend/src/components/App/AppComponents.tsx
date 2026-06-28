import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, Maximize2, ArrowLeft, X,
  Sparkles, Info, Database, Paperclip, Mic, Download, RefreshCw,
  FileText, LayoutGrid, Shield, Key, Plus, Activity,
  AlertTriangle, Loader2, Check, LogOut,
  ChevronDown, ArrowRight, Search,
  Network, Sun, Moon, Monitor,
} from "lucide-react";
import type { CardData, Model, User } from "../../types";
import {
  BACKEND_URL,
  AURA_THEME_BG,
  AURA_THEME_OVERLAY,
  INITIAL_MODELS,
  MAX_CONNECTED_MODELS,
  MODEL_LIMIT_ALERT,
  getAuthHeaders,
  hashApiKey,
  isPaidModel,
  isSpecializedNonChatModel,
  modelAvailabilityRank,
  normalizeApiKey,
  sortModelsByAvailability,
} from "../../appCore";
export const Markdown: React.FC<{ text?: string }> = ({ text }) => {
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

export const Dots: React.FC<{ color?: string }> = ({ color = "var(--gold)" }) => (
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

export const WalletConnectModal = React.forwardRef<HTMLDivElement, WalletConnectModalProps>(
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

export const ConnectWallet = React.forwardRef<HTMLDivElement, ConnectWalletProps>(({ walletAddress, ethBalance, onClose, onDisconnect }, forwardedRef) => {
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

export const PearlOrb: React.FC<PearlOrbProps> = ({ onClick, isDark }) => (
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

export const Onboarding = React.forwardRef<HTMLDivElement, OnboardingProps>(({ onComplete, onOAuthLogin, onShowWalletModal }, ref) => {
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

export const SettingsModal = React.forwardRef<HTMLDivElement, SettingsModalProps>(({
  onClose, theme, setTheme, models, setModels, connected, setConnected, user, setUser, onOAuthLogin, onLogout, onShowWalletModal
}, ref) => {
  const [tab, setTab] = useState<"nodes" | "appearance" | "profile" | "models">("nodes");
  const [addingNode, setAddingNode] = useState(false);
  const [nProv, setNProv] = useState("");
  const [nName, setNName] = useState("");
  const [nAddress, setNAddress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<string | null>(null);
  const [settingsModelSearch, setSettingsModelSearch] = useState("");

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

  const openAddModels = () => {
    handleProviderChange("openrouter");
    setAddingKey(true);
  };

  const TABS = [
    { id: "nodes", label: "Network Nodes" },
    { id: "appearance", label: "Appearance" },
    { id: "profile", label: "Profile" },
    { id: "models", label: "Models" },
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

          {tab === "nodes" && (
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

              <div
                style={{
                  width: "calc(100% - 30px)",
                  marginBottom: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <button
                  className="hf-directory-button"
                  onClick={() => setIsHfDirectoryOpen(true)}
                >
                  <span style={{ fontSize: "1.1rem" }}>🤗</span> Browse Open-Source Models (Hugging Face)
                </button>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn-social" onClick={openAddModels} style={{ flex: 1, minWidth: 160 }}>
                    <Plus size={16} /> Add Models
                  </button>
                  <button className="btn-social" onClick={() => setAddingNode(true)} style={{ flex: 1, minWidth: 200 }}>
                    <Network size={16} /> Connect P2P Node (BYOC)
                  </button>
                  <button className="btn-social" onClick={() => setAddingKey(true)} style={{ flex: 1, minWidth: 200 }}>
                    <Key size={16} /> Bring Your Own Key (BYOK)
                  </button>
                </div>
              </div>

              {/* ── MODEL ROWS (ALL NODES) ── */}
              <div style={{ display: "none", flexDirection: "column", gap: 8, width: "calc(100% - 30px)" }}>
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

            </div>
          )}

          {tab === "models" && (
            <div className="s-section">
              <div className="s-sec-header">
                <div>
                  <h3 className="s-title">Models</h3>
                  <p className="s-sub">Search and manage every model available in AURA.</p>
                </div>
              </div>

              <div style={{ width: "calc(100% - 30px)", marginBottom: 12 }}>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <Search size={14} style={{ position: "absolute", left: 12, color: "var(--gold)", opacity: 0.75 }} />
                  <input
                    type="text"
                    value={settingsModelSearch}
                    onChange={(e) => setSettingsModelSearch(e.target.value)}
                    placeholder="Search models & providers..."
                    style={{
                      width: "100%",
                      background: "var(--bg2)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "10px 12px 10px 36px",
                      fontSize: 13,
                      color: "var(--t1)",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "calc(100% - 30px)" }}>
                {models
                  .filter((m) => {
                    const term = settingsModelSearch.trim().toLowerCase();
                    return (
                      !term ||
                      m.name.toLowerCase().includes(term) ||
                      m.provider.toLowerCase().includes(term)
                    );
                  })
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
export const ResponseCard: React.FC<{ data: CardData; onExpand: (data: CardData) => void }> = ({ data, onExpand }) => {
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

export const ExpandedView = React.forwardRef<HTMLDivElement, ExpandedViewProps>(({ model, onClose, onFollowUp, onFileUpload, uploadedFiles, isUploading }, ref) => {
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
  onFilesDrop?: (files: File[]) => Promise<void> | void;
  placeholder?: string;
  uploadedFiles?: string[];
  onRemoveUploadedFile?: (fileName: string) => void;
  isUploading?: boolean;
  isCouncilMode: boolean;
  setIsCouncilMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export const InputBar: React.FC<InputBarProps> = ({
  query, setQuery, onSend, models, connected, setConnected,
  onEnhance, enhancing, onFileUpload, onFilesDrop, placeholder, uploadedFiles, onRemoveUploadedFile, isUploading,
  isCouncilMode, setIsCouncilMode
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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
    <div
      className="input-bar"
      onDragEnter={() => setIsDragging(true)}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        const droppedFiles = Array.from(event.dataTransfer.files);
        if (droppedFiles.length > 0) {
          void onFilesDrop?.(droppedFiles);
        }
      }}
      style={{
        borderStyle: isDragging ? "dashed" : undefined,
        borderColor: isDragging ? "var(--gold)" : undefined,
        boxShadow: isDragging ? "0 0 0 3px color-mix(in srgb, var(--gold) 20%, transparent)" : undefined,
      }}
    >
      {uploadedFiles && uploadedFiles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 4px 8px" }} role="list" aria-label="Attached files">
          {uploadedFiles.map(fileName => (
            <div
              key={fileName}
              role="listitem"
              title={fileName}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                maxWidth: 240,
                background: "var(--bg3)",
                color: "var(--t1)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "6px 10px",
                animation: "fadeIn 0.15s ease-out",
              }}
            >
              <FileText size={14} style={{ color: "var(--t3)", flexShrink: 0 }} />
              <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {fileName.length > 22 ? `${fileName.slice(0, 19)}...` : fileName}
              </span>
              {onRemoveUploadedFile && (
                <button
                  type="button"
                  aria-label={`Remove ${fileName}`}
                  onClick={() => onRemoveUploadedFile(fileName)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--t3)",
                    display: "inline-flex",
                    alignItems: "center",
                    cursor: "pointer",
                    padding: 0,
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={(event) => { event.currentTarget.style.color = "#F87171"; }}
                  onMouseLeave={(event) => { event.currentTarget.style.color = "var(--t3)"; }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
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
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onFileUpload} accept=".pdf,.txt,.md,image/*" />
        </label>

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

export const FloatingSummarizer: React.FC<FloatingSummarizerProps> = ({ visible, loading, summary, onAmalgamate }) => {
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
        AURA Supervisor
      </div>
      <div style={{ padding: 12 }}>
        <button className="btn-primary full" onClick={onAmalgamate} disabled={loading}>
          {loading ? "Synthesizing..." : "Create Best Answer"}
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

