import type { ReactNode } from "react";
import type { IncomingMessage } from "../types/message";

type MessageStatus = {
  symbol: string;
  color: string;
  label: string;
};

type MessageBubbleProps = {
  message: IncomingMessage;
  selected: boolean;
  reactions?: string[];
  status?: MessageStatus;
  timestamp: string;
  children?: ReactNode;
};

// Keep message presentation isolated while the parent owns focus and message actions.
export function MessageBubble({ message, selected, reactions, status, timestamp, children }: MessageBubbleProps) {
  return (
    <div style={{ display: "flex", justifyContent: message.fromMe ? "flex-end" : "flex-start", width: "100%" }}>
      <div style={{ position: "relative", maxWidth: "88%", padding: "10px 12px", borderRadius: message.fromMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: message.fromMe ? "rgba(55, 128, 108, 0.5)" : "rgba(255,255,255,0.11)", border: selected ? "2px solid rgba(126, 211, 181, 0.9)" : "2px solid transparent", textAlign: "left" }}>
        {reactions && <span aria-label="Message reactions" style={{ position: "absolute", top: "-10px", right: "-8px", borderRadius: "14px", minWidth: "28px", minHeight: "28px", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px", background: "#4b2732", fontSize: "16px" }}>{reactions.join(" ")}</span>}
        <div style={{ fontSize: "12px", opacity: 0.68, marginBottom: message.body ? "3px" : 0 }}>{message.fromMe ? "You" : message.sender}</div>
        {message.body && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.3 }}>{message.body}</div>}
        {children}
        <div style={{ fontSize: "10px", opacity: 0.58, marginTop: "6px", textAlign: "right" }}>
          {timestamp}
          {message.fromMe && status && <span title={status.label} aria-label={status.label} style={{ marginLeft: "5px", color: status.color, fontWeight: 700 }}>{status.symbol}</span>}
        </div>
      </div>
    </div>
  );
}
