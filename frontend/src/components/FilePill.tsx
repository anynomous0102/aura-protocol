import { File as FileIcon, FileText, Image, X } from "lucide-react";
import type { ReactElement } from "react";

export interface FilePillProps {
  file: File;
  onRemove: (fileName: string) => void;
}

function displayName(name: string): string {
  if (name.length <= 22) return name;
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  return `${name.slice(0, 18 - extension.length)}...${extension}`;
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function iconForFile(file: File): ReactElement {
  if (file.type.startsWith("image/")) return <Image size={14} />;
  if (file.type === "application/pdf" || file.type.startsWith("text/")) return <FileText size={14} />;
  return <FileIcon size={14} />;
}

export function FilePill({ file, onRemove }: FilePillProps): ReactElement {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-1 duration-150"
      role="listitem"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        maxWidth: 280,
        borderRadius: 999,
        padding: "6px 10px",
        background: "var(--file-pill-bg, #262626)",
        color: "#e5e5e5",
      }}
      title={`${file.name} (${formatBytes(file.size)})`}
    >
      <span style={{ display: "inline-flex", color: "#a3a3a3", flexShrink: 0 }}>{iconForFile(file)}</span>
      <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {displayName(file.name)}
      </span>
      <span style={{ fontSize: 11, color: "#a3a3a3", flexShrink: 0 }}>{formatBytes(file.size)}</span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={() => onRemove(file.name)}
        style={{
          border: "none",
          background: "transparent",
          color: "#a3a3a3",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          padding: 0,
          flexShrink: 0,
          transition: "color 0.15s ease",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = "#f87171";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = "#a3a3a3";
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default FilePill;
