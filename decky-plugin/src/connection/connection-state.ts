// Map bridge, socket, and WhatsApp state into user-facing connection labels.
export type BridgeHttpState = "connected" | "connecting" | "disconnected" | "disabled" | "unknown";
export type BridgeSocketState = "connected" | "connecting" | "disconnected" | "disabled" | "unknown";
export type WhatsAppState = "starting" | "qr_required" | "authenticated" | "ready" | "disconnected" | "auth_failure" | "disabled" | "unknown";
export function getConnectionToggleLabel(enabled: boolean): "Start" | "Stop this Deck" {
  return enabled ? "Stop this Deck" : "Start";
}

export function createPluginConnectionSession() {
  let enabled = false;
  return {
    isEnabled: () => enabled,
    setEnabled: (next: boolean) => { enabled = next; }
  };
}

export function runResumeRecovery(enabled: boolean, recover: () => void): boolean {
  if (!enabled) return false;
  recover();
  return true;
}

export function getConnectionHeadline(enabled: boolean, http: BridgeHttpState, socket: BridgeSocketState, whatsapp: WhatsAppState): string {
  if (!enabled) return "Disabled";
  if (http === "disconnected") return "Computer unavailable";
  if (socket === "disconnected") return "Reconnecting";
  if (whatsapp === "qr_required" || whatsapp === "auth_failure") return "Authentication required";
  if (whatsapp === "disconnected") return "Reconnecting";
  if (http === "connected" && socket === "connected" && whatsapp === "ready") return "Connected";
  return "Connecting";
}

export function getConnectionWarning(enabled: boolean, http: BridgeHttpState, socket: BridgeSocketState, whatsapp: WhatsAppState): string {
  if (!enabled) return "";
  if (http === "disconnected") return "Computer unavailable. Retrying connection…";
  if (socket === "disconnected") return "WebSocket disconnected. Reconnecting…";
  if (whatsapp === "disconnected") return "WhatsApp disconnected. Reconnecting…";
  return "";
}
