import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[AURA] UI boundary captured error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="session" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 460, border: "1px solid var(--border2)", borderRadius: 8, padding: 20, background: "var(--bg2)", color: "var(--t1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, marginBottom: 8 }}>
            <AlertTriangle size={18} color="var(--gold)" />
            AURA view recovered
          </div>
          <p style={{ color: "var(--t2)", fontSize: 13, lineHeight: 1.6, margin: "0 0 14px" }}>
            This panel crashed independently. Your session shell is still running.
          </p>
          <button className="btn-sm" onClick={() => this.setState({ error: null })}>
            <RefreshCw size={14} /> Retry view
          </button>
        </div>
      </div>
    );
  }
}
