import { FileText, Home, MessageSquare, PanelLeft, PanelRight, Settings, Shield, Trash2, X } from "lucide-react";
import type { CardData, User } from "../../types";

export interface SidebarSession {
  title: string;
  cards: CardData[];
  ts: number;
}

export interface SidebarProps {
  route: string;
  cardsCount: number;
  showHistory: boolean;
  isMobileMenuOpen: boolean;
  sidebarCollapsed: boolean;
  sessionHistory: SidebarSession[];
  user: User;
  walletBalance: number;
  onRouteHome: () => void;
  onRouteSession: () => void;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onOpenSettings: () => void;
  onLoadSession: (session: SidebarSession) => void;
  onDeleteSession: (index: number) => void;
}

export function Sidebar(props: SidebarProps) {
  const {
    route,
    cardsCount,
    showHistory,
    isMobileMenuOpen,
    sidebarCollapsed,
    sessionHistory,
    user,
    walletBalance,
    onRouteHome,
    onRouteSession,
    onToggleCollapse,
    onCloseMobile,
    onOpenSettings,
    onLoadSession,
    onDeleteSession,
  } = props;

  return (
    <aside className={`sidebar ${isMobileMenuOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
      <div className="s-brand">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="s-icon">A</div>
          <div className="s-name">AURA</div>
        </div>
        <button className="icon-btn desktop-only" style={{ background: "transparent" }} onClick={onToggleCollapse}>
          {sidebarCollapsed ? <PanelRight size={18} /> : <PanelLeft size={18} />}
        </button>
        <button className="mobile-close" onClick={onCloseMobile}>
          <X size={18} />
        </button>
      </div>

      <button className={`nav-btn ${route === "home" ? "active" : ""}`} onClick={onRouteHome}>
        <Home size={16} /> <span className="nav-text">Home</span>
      </button>
      <button className={`nav-btn ${route === "session" ? "active" : ""}`} disabled={cardsCount === 0 && !showHistory} onClick={onRouteSession}>
        <MessageSquare size={16} /> <span className="nav-text">Session</span>
      </button>

      {!sidebarCollapsed && sessionHistory.length > 0 && (
        <div className="custom-scrollbar" style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
          {sessionHistory.slice(0, 8).map((session, index) => (
            <div key={session.ts} className="sess-hist-item" style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <button className="nav-btn" style={{ fontSize: 12, padding: "6px 28px 6px 32px", opacity: 0.85, minHeight: "auto", flex: 1, minWidth: 0 }} onClick={() => onLoadSession(session)}>
                <FileText size={12} />
                <span className="nav-text" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.title.replace(/^✨\s*/, "").slice(0, 24)}{session.title.length > 27 ? "..." : ""}
                </span>
              </button>
              <button className="sess-del-btn" title="Delete session" onClick={() => onDeleteSession(index)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-bot">
        {!sidebarCollapsed && (
          <div style={{ padding: 14, background: "var(--bg)", borderRadius: 14, border: "1px solid var(--border2)", marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              OAPIN Ledger <Shield size={12} color="var(--gold)" />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--t1)", fontFamily: "'JetBrains Mono', monospace" }}>
              {user.isAuthenticated ? walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"} <span style={{ fontSize: 12, color: "var(--gold)", fontFamily: "'Sora', sans-serif" }}>CR</span>
            </div>
          </div>
        )}
        <button className="nav-btn" onClick={onOpenSettings}>
          <Settings size={16} /> <span className="nav-text">Settings</span>
        </button>
        <button className="user-row" onClick={onOpenSettings}>
          <div className="user-av">{user.photo ? <img src={user.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : user.name[0]?.toUpperCase()}</div>
          <span className="user-nm">{user.name}</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
