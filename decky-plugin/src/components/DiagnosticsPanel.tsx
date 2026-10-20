import { ButtonItem, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaArrowLeft } from "react-icons/fa";
import type { BridgeHttpState, BridgeSocketState } from "../connection/connection-state";
import type { BridgeStatus, DataProvider } from "../providers/provider";

type DiagnosticsPanelProps = {
  enabled: boolean;
  httpState: BridgeHttpState;
  socketState: BridgeSocketState;
  providerVariant: DataProvider["variant"];
  status: BridgeStatus;
  statusUpdatedAt?: number;
  lastHealthCheckAt?: number;
  sessionId: string;
  lastError: string;
  onReconnect: () => void;
  onBack: () => void;
};

function formatDiagnosticTime(value?: number): string {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Never";
}

export function DiagnosticsPanel({ enabled, httpState, socketState, providerVariant, status, statusUpdatedAt, lastHealthCheckAt, sessionId, lastError, onReconnect, onBack }: DiagnosticsPanelProps) {
  return (
    <PanelSection title="Diagnostics">
      <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "4px 0 8px" }}>Connection details for troubleshooting Decky WhatsApp.</div></PanelSectionRow>
      <PanelSectionRow><div><strong>Plugin</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{enabled ? "Enabled" : "Disabled"}</div></div></PanelSectionRow>
      <PanelSectionRow><div><strong>Bridge HTTP</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{httpState === "connected" ? "Reachable" : httpState === "connecting" ? "Checking…" : httpState === "disabled" ? "Disabled" : "Unavailable"}</div></div></PanelSectionRow>
      <PanelSectionRow><div><strong>WebSocket tunnel</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{socketState}</div></div></PanelSectionRow>
      <PanelSectionRow><div><strong>{providerVariant === "mock" ? "Mock session" : "WhatsApp Web"}</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{status}</div></div></PanelSectionRow>
      <PanelSectionRow><div><strong>Authentication</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{status === "ready" ? "Authenticated and ready" : status === "authenticated" ? "Authenticated; still starting" : status === "qr_required" ? "QR code required" : status === "auth_failure" ? "Authentication failed" : "Not confirmed"}</div></div></PanelSectionRow>
      <PanelSectionRow><div><strong>Last status update</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{formatDiagnosticTime(statusUpdatedAt)}</div></div></PanelSectionRow>
      <PanelSectionRow><div><strong>Last health check</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{formatDiagnosticTime(lastHealthCheckAt)}</div></div></PanelSectionRow>
      {sessionId && <PanelSectionRow><div><strong>Bridge session</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px", fontFamily: "monospace" }}>{sessionId}</div></div></PanelSectionRow>}
      <PanelSectionRow><div><strong>Last error</strong><div style={{ opacity: lastError ? 0.85 : 0.55, color: lastError ? "#ff9b9b" : undefined, fontSize: "12px", marginTop: "3px", whiteSpace: "pre-wrap" }}>{lastError || "None recorded"}</div></div></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onReconnect}><span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Reconnect</span></ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onBack}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to settings</span></ButtonItem></PanelSectionRow>
    </PanelSection>
  );
}
