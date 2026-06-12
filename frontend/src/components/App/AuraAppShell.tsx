import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ethers } from "ethers";
import { Toaster, toast } from "sonner";
import LandingPage from "../../LandingPage";
import {
  Home, MessageSquare, Settings, Bot, X,
  Sparkles, FileText, LayoutGrid, Shield, Trash2,
  AlertTriangle, Loader2, Menu,
  PanelRight, PanelLeft,
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
import type { CardData, Message, Model } from "../../types";
import {
  BACKEND_URL,
  GOOGLE_CLIENT_ID,
  INITIAL_MODELS,
  callAI,
  getAuthHeaders,
  getDefaultConnectedModels,
  loadGoogleSdk,
  setClientAccessToken,
  sortModelsByAvailability,
} from "../../appCore";
import { secureFetch } from "../../utils/secureFetch";
import {
  isExpiredToken,
  readStoredAccessToken,
  sessionSecretFromToken,
  useAuraAuth,
} from "../../hooks/useAuraAuth";
import {
  ConnectWallet,
  Dots,
  ExpandedView,
  FloatingSummarizer,
  InputBar,
  Markdown,
  Onboarding,
  PearlOrb,
  ResponseCard,
  SettingsModal,
  WalletConnectModal,
} from "./AppComponents";

export default function App() {
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const {
    user,
    setUser,
    authToken,
    setAuthToken,
    authState,
    setAuthState,
    persistToken: persistAccessToken,
    clearToken: clearAccessToken,
  } = useAuraAuth();
  const [onboarded, setOnboarded] = useState<boolean>(() => typeof window !== 'undefined' ? localStorage.getItem("aura-final") === "1" : false);
  const [guestLandingSkipped, setGuestLandingSkipped] = useState(false);
  const [theme, setTheme] = useState<string>(() => typeof window !== 'undefined' ? localStorage.getItem("aura-theme") || "system" : "system");
  const [sysDark, setSysDark] = useState<boolean>(() => typeof window !== 'undefined' ? window.matchMedia("(prefers-color-scheme:dark)").matches : false);
  const [models, setModels] = useState<Model[]>(() => sortModelsByAvailability(INITIAL_MODELS));
  const [connected, setConnected] = useState<Model[]>(() => getDefaultConnectedModels(INITIAL_MODELS));

  // ── AUTHENTICATION STATE ──

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
  const MAX_FILES = 4;

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
  const secureJsonRequest = useCallback(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : "";
    const headers = {
      ...(init.headers as Record<string, string> | undefined),
      ...getAuthHeaders(),
    };
    const sessionSecret = authToken ? sessionSecretFromToken(authToken) : null;
    if (!sessionSecret) {
      return fetch(url, { ...init, method, headers });
    }
    return secureFetch(url, {
      method,
      headers,
      body,
      sessionSecret,
      signal: init.signal ?? undefined,
    });
  }, [authToken, getAuthHeaders]);

  const expandedModel = cards.find(c => c.cardId === expandedId);

  // ── FIX: When user skips landing page, load full model catalog ──
  useEffect(() => {
    if (guestLandingSkipped) setConnected(getDefaultConnectedModels(models));
  }, [guestLandingSkipped, models]);

  // ── 💾 SESSION PERSISTENCE: LOAD ──
  useEffect(() => {
    if (!user.isAuthenticated || !user.email) return;

    secureJsonRequest(`${BACKEND_URL}/api/history/load/${encodeURIComponent(user.email)}`)
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
  }, [user.isAuthenticated, user.email, secureJsonRequest]);

  useEffect(() => {
    let cancelled = false;
    const hydrateSession = async (): Promise<void> => {
      const token = await readStoredAccessToken();
      if (!token || isExpiredToken(token)) {
        await clearAccessToken();
        if (!cancelled) {
          setAuthState('unauthenticated');
          setAuthReady(true);
        }
        return;
      }

      setAuthToken(token);
      setClientAccessToken(token);
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` } as HeadersInit
        });
        if (!res.ok) throw new Error("Session invalid");
        const data = await res.json();
        const profile = data.user;
        if (!profile) throw new Error("Session profile missing");
        if (!cancelled) {
          setUser({
            name: profile.name || "AURA User",
            email: profile.email || profile.sub,
            photo: profile.picture || null,
            isAuthenticated: true
          });
          setAuthState('authenticated');
        }
      } catch {
        await clearAccessToken();
        if (!cancelled) setAuthState('unauthenticated');
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };

    void hydrateSession();
    return () => {
      cancelled = true;
    };
  }, [clearAccessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsAppLoading(false), 850);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!user.isAuthenticated) return;
    secureJsonRequest(`${BACKEND_URL}/api/chats/sessions`, {
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
  }, [user.isAuthenticated, getAuthHeaders, secureJsonRequest]);

  // ── 💾 SESSION PERSISTENCE: AUTO-SYNC (DEBOUNCED) ──
  useEffect(() => {
    if (!user.isAuthenticated || !user.email || cards.length === 0) return;

    const syncTimer = setTimeout(() => {
      secureJsonRequest(`${BACKEND_URL}/api/history/sync`, {
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
  }, [cards, walletBalance, user.isAuthenticated, user.email, secureJsonRequest]);

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
        const res = await secureJsonRequest(`${BACKEND_URL}/api/groq/models`, {
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
  }, [getAuthHeaders, secureJsonRequest]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme:dark)");
    const h = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  useEffect(() => { localStorage.setItem("aura-theme", theme); }, [theme]);

  const isDark = theme === "dark" || (theme === "system" && sysDark);
  const isBooting = isAppLoading || !authReady || authState === 'loading';

  

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

            if (dbUser.access_token) {
              await persistAccessToken(dbUser.access_token);
            }

            setUser({
              name: dbUser.user.name,
              email: dbUser.user.email,
              photo: dbUser.user.picture,
              isAuthenticated: true
            });
            setAuthState('authenticated');
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
                  await persistAccessToken(dbUser.access_token);
                }
                setUser({
                  name: dbUser.user.name,
                  email: dbUser.user.email,
                  photo: dbUser.user.picture,
                  isAuthenticated: true
                });
                setAuthState('authenticated');
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
        await persistAccessToken(dbUser.access_token);
      }

      setUser({
        name: dbUser.user.name,
        email: dbUser.user.email,
        photo: dbUser.user.picture,
        isAuthenticated: true
      });
      setAuthState('authenticated');
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
    setAuthState('unauthenticated');
    setWalletAddress("");
    setEthBalance("0.000");
    setShowConnectedWallet(false);
    void clearAccessToken();
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
      await persistAccessToken(dbUser.access_token);
    }

    setWalletAddress(address);
    setEthBalance("0.000"); // No provider in manual flow
    setUser({
      name: dbUser.user.name,
      email: dbUser.user.email,
      photo: dbUser.user.picture,
      isAuthenticated: true,
    });
    setAuthState('authenticated');
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
        await persistAccessToken(dbUser.access_token);
      }

      setUser({
        name: dbUser.user.name,
        email: dbUser.user.email,
        photo: dbUser.user.picture,
        isAuthenticated: true,
      });
      setAuthState('authenticated');
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
      const res = await secureJsonRequest(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ model_id: "gemini", messages: [{ role: "user", text: `Generate a very short elegant title for: "${q}".` }], user_id: user.email, session_id: sessionId })
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setSessionTitle((data.text.length > 50 || data.text.includes("**[")) ? ` ${q.slice(0, 30)}...` : ` ${data.text.replace(/["']/g, '').trim()}`);
      } else {
        setSessionTitle(` ${q.slice(0, 30)}...`);
      }
    } catch (err) {
      setSessionTitle(` ${q.slice(0, 30)}...`);
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

              const verifyRes = await secureJsonRequest(`${BACKEND_URL}/api/oapin/verify`, {
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

              const verifyRes = await secureJsonRequest(`${BACKEND_URL}/api/oapin/verify`, {
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
  }, [query, connected, user.email, user.name, user.isAuthenticated, targetMode, isCouncilMode, secureJsonRequest]);

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
  const uploadFiles = async (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return;
    if (uploadedFiles.length + selectedFiles.length > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} files allowed. Remove a file to add another.`);
      return;
    }

    setIsUploading(true);

    const formData = new FormData();
    formData.append("user_id", user.isAuthenticated ? (user.email || user.name) : "anonymous");

    const newFileNames: string[] = [];

    selectedFiles.forEach(file => {
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
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    try {
      await uploadFiles(files);
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const removeUploadedFile = (fileName: string) => {
    setUploadedFiles(prev => prev.filter(name => name !== fileName));
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
      <Toaster richColors position="top-right" />
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
        .aura-typewriter {
          display: inline-block;
          overflow: hidden;
          white-space: nowrap;
          border-right: 3px solid currentColor;
          font-family: 'Courier New', Courier, monospace;
          width: 0;
          font-size: 4rem;
          font-weight: 700;
          color: var(--t1); 
          animation: 
            aura-typing 1.4s steps(4, end) 0.3s forwards,
            aura-blink 0.8s step-end 1.7s infinite;
        }

        .typewriter-gold .aura-typewriter {
          color: var(--gold); 
        }
        @keyframes aura-typing {
          from { width: 0ch; }
          to { width: 4.2ch; }
        }
        @keyframes aura-blink {
          0%, 100% { border-color: transparent; }
          50% { border-color: currentColor; }
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
                <span className="aura-typewriter">AURA</span>
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
                        onFilesDrop={uploadFiles}
                        uploadedFiles={uploadedFiles}
                        onRemoveUploadedFile={removeUploadedFile}
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
                    onFilesDrop={uploadFiles}
                    placeholder="Broadcast query across your council…"
                    uploadedFiles={uploadedFiles}
                    onRemoveUploadedFile={removeUploadedFile}
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
