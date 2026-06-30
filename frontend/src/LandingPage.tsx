import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Bot, KeyRound, Network, Shield } from "lucide-react";

interface LandingPageProps {
  onOAuthLogin: (provider: string, walletId?: string) => Promise<void>;
  onSkip: () => void;
  onShowWalletModal: () => void;
}

const AURA_THEME = {
  dark: { bg: "#000000", overlay: "rgba(0,0,0,0.88)", text: "#E8F4FD", muted: "#7DB8D4" },
  light: { bg: "#F9F7F2", overlay: "rgba(249,247,242,0.9)", text: "#1A1A1A", muted: "#6B6B6B" },
};

export default function LandingPage({ onOAuthLogin, onSkip, onShowWalletModal }: LandingPageProps) {
  const [loading, setLoading] = useState<"google" | "github" | null>(null);
  const [error, setError] = useState("");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const selectedTheme = (localStorage.getItem("aura-theme") || "system").toLowerCase();
  const isDark = selectedTheme === "dark" || (selectedTheme === "system" && systemDark);
  const theme = isDark ? AURA_THEME.dark : AURA_THEME.light;

  const login = async (provider: "google" | "github") => {
    setError("");
    setLoading(provider);
    try {
      await onOAuthLogin(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  const skipOnboarding = () => {
    onSkip();
  };

  return (
    <motion.div
      className="aura-landing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{
        "--landing-bg": theme.bg,
        "--landing-overlay": theme.overlay,
        "--landing-text": theme.text,
        "--landing-muted": theme.muted,
      } as React.CSSProperties}
    >
      <div className="landing-shell">
        <motion.div
          className="landing-hero"
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="landing-brand">
            <span className="brand-mark"><Bot size={20} /></span>
            AURA
          </div>
          <h1>One Query. Every Model. Zero Limits.</h1>
          <p>The decentralized AI protocol aggregator.</p>
          <div className="landing-auth">
            <button
              type="button"
              className="auth-primary"
              onClick={() => login("google")}
              disabled={loading !== null}
            >
              <KeyRound size={18} />
              {loading === "google" ? "Connecting..." : "Continue with Google"}
              <ArrowRight size={17} />
            </button>

            <button
              type="button"
              className="auth-secondary github-auth"
              onClick={() => login("github")}
              disabled={loading !== null}
            >
              <KeyRound size={18} />
              {loading === "github" ? "Connecting..." : "Login with GitHub"}
              <ArrowRight size={17} />
            </button>

            <button
              type="button"
              className="auth-secondary"
              onClick={onShowWalletModal}
              disabled={loading !== null}
            >
              <Shield size={18} />
              Connect Web3 Wallet (DID)
            </button>

            <button
              type="button"
              className="auth-secondary"
              onClick={skipOnboarding}
              style={{ background: "rgba(255,255,255,0.03)", borderStyle: "dashed" }}
            >
              Skip for now
            </button>
          </div>
          {error && <div className="landing-error">{error}</div>}
        </motion.div>

        <motion.div
          className="landing-panel"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.08, duration: 0.45, ease: "easeOut" }}
        >
          <div className="panel-top">
            <Network size={18} />
            Live model mesh
          </div>
          <div className="mesh-list">
            {["OpenRouter", "Gemini", "Claude", "Llama", "Mistral"].map((node, index) => (
              <div className="mesh-row" key={node}>
                <span style={{ background: ["#f5b73f", "#60a5fa", "#f97316", "#34d399", "#a78bfa"][index] }} />
                <strong>{node}</strong>
                <em>{index === 0 ? "gateway" : "node"}</em>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      <style>{`
        .aura-landing {
          position: fixed;
          inset: 0;
          z-index: 10000;
          background:
            radial-gradient(circle at 22% 18%, rgba(245, 183, 63, 0.16), transparent 32%),
            radial-gradient(circle at 80% 20%, rgba(96, 165, 250, 0.14), transparent 30%),
            var(--landing-bg);
          color: var(--landing-text);
          font-family: 'Sora', system-ui, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .landing-shell {
          width: min(1120px, 100%);
          min-height: min(720px, 92vh);
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.7fr);
          gap: 44px;
          align-items: center;
        }
        .landing-brand {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: #f5b73f;
          font-weight: 800;
          font-size: 14px;
          margin-bottom: 28px;
        }
        .brand-mark {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: rgba(245, 183, 63, 0.12);
          border: 1px solid rgba(245, 183, 63, 0.25);
        }
        .landing-hero h1 {
          font-size: clamp(48px, 8vw, 92px);
          line-height: 0.95;
          margin: 0;
          max-width: 760px;
        }
        .landing-hero p {
          color: var(--landing-muted);
          font-size: clamp(18px, 2.2vw, 24px);
          line-height: 1.45;
          margin: 22px 0 32px;
        }
        .landing-auth {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }
        .landing-auth button {
          min-height: 52px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.12);
          padding: 0 18px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-weight: 800;
          cursor: pointer;
          transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
        }
        .landing-auth button:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(245, 183, 63, 0.5);
        }
        .landing-auth button:disabled {
          opacity: 0.66;
          cursor: wait;
        }
        .auth-primary {
          background: #f5b73f;
          color: #111827;
        }
        .auth-secondary {
          background: var(--landing-overlay);
          color: var(--landing-text);
        }
        .github-auth {
          border-color: rgba(255,255,255,0.2) !important;
        }
        .landing-error {
          margin-top: 14px;
          color: #fecaca;
          font-size: 13px;
        }
        .landing-panel {
          border: 1px solid rgba(255,255,255,0.12);
          background: var(--landing-overlay);
          backdrop-filter: blur(18px);
          border-radius: 24px;
          padding: 18px;
          box-shadow: 0 30px 90px rgba(0,0,0,0.35);
        }
        .panel-top {
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--landing-text);
          font-weight: 800;
          padding: 8px 8px 16px;
        }
        .mesh-list {
          display: grid;
          gap: 10px;
        }
        .mesh-row {
          height: 58px;
          border-radius: 14px;
          background: rgba(4, 7, 12, 0.55);
          border: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 14px;
        }
        .mesh-row span {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          box-shadow: 0 0 18px currentColor;
        }
        .mesh-row strong {
          flex: 1;
          font-size: 14px;
        }
        .mesh-row em {
          color: #8d96a6;
          font-size: 12px;
          font-style: normal;
        }
        @media (max-width: 860px) {
          .landing-shell {
            grid-template-columns: 1fr;
            gap: 28px;
          }
          .landing-panel {
            display: none;
          }
          .landing-auth button {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </motion.div>
  );
}
