import { Bot, LayoutGrid, Loader2, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { CardData } from "../../types";
import { Dots, Markdown, ResponseCard } from "../App/AppComponents";

export interface ChatSessionProps {
  cards: CardData[];
  sessionTitle: string;
  synthesis: string | null;
  synthesizing: boolean;
  onSynthesize: () => void;
  onClearSynthesis: () => void;
  onViewAll: () => void;
  onReset: () => void;
  onExpand: (card: CardData) => void;
}

export function ChatSession({
  cards,
  sessionTitle,
  synthesis,
  synthesizing,
  onSynthesize,
  onClearSynthesis,
  onViewAll,
  onReset,
  onExpand,
}: ChatSessionProps) {
  return (
    <>
      <div className="sess-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sess-meta">Session stream · {cards.length} intelligent agents</div>
          <div className="sess-q" title={sessionTitle}>{sessionTitle}</div>
        </div>
        <div className="sess-actions">
          <button className="btn-sm" onClick={onSynthesize} disabled={synthesizing || cards.every((card) => card.state !== "complete")}>
            {synthesizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Synthesize
          </button>
          <button className="btn-sm" onClick={onViewAll}>
            <LayoutGrid size={14} /> View all
          </button>
          <button className="btn-sm danger" onClick={onReset}>
            <X size={14} /> Reset
          </button>
        </div>
      </div>

      <AnimatePresence>
        {synthesis && (
          <motion.div key="synthesis" className="synth-box" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <div className="synth-head">
              <span className="synth-lbl">Aggregated Synthesis</span>
              <button className="icon-btn" onClick={onClearSynthesis}>
                <X size={16} />
              </button>
            </div>
            {synthesis === "..." ? <Dots /> : <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--t2)" }}><Markdown text={synthesis} /></div>}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="cards-area">
        <div className="cards-grid">
          {cards.map((card) => {
            const lastMsg = card.messages.filter((message) => message.role === "model").slice(-1)[0];
            let supervisorPrefix: string | null = null;
            let cleanText = lastMsg?.text || "";
            if (cleanText.includes("**[🤖 AURA Supervisor]**")) {
              const parts = cleanText.split("\n\n");
              supervisorPrefix = parts[0].replace("**[🤖 AURA Supervisor]** Analyzed intent and auto-routed task to **", "").replace("**.", "");
              cleanText = parts.slice(1).join("\n\n");
            }

            return (
              <div key={card.cardId} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {supervisorPrefix && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ background: "rgba(245, 158, 11, 0.05)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <Bot size={16} />
                    <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 500 }}>Delegating task to <strong style={{ color: "var(--t1)" }}>{supervisorPrefix}</strong> compute node.</div>
                  </motion.div>
                )}
                <ResponseCard data={{ ...card, messages: [...card.messages.slice(0, -1), { role: "model", text: cleanText }] }} onExpand={onExpand} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default ChatSession;
