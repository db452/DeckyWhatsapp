import { ButtonItem, PanelSection, PanelSectionRow, TextField } from "@decky/ui";
import { FaCog } from "react-icons/fa";
import { ContactAvatar } from "./ContactAvatar";
import { formatChatTimestamp } from "../messages/format";
import type { BridgeStatus, DataProvider } from "../providers/provider";
import type { ChatSummary } from "../types/chat";

export type ContactsState = "idle" | "loading" | "loaded" | "failed";

type ContactBrowserProps = {
  providerVariant: DataProvider["variant"];
  enabled: boolean;
  status: BridgeStatus;
  contactsState: ContactsState;
  chatsCount: number;
  visibleChats: ChatSummary[];
  activeConnectionWarning: string;
  mockSearchQuery: string;
  onSimulateIncoming: () => void;
  onSimulateReaction: () => void;
  onSwitchSession: () => void;
  onSimulateError: () => void;
  onSimulateReconnect: () => void;
  onSimulateSendFailure: () => void;
  onSimulateMediaFailure: () => void;
  onSimulateDelay: (milliseconds: number) => void;
  onResetMockScenario: () => void;
  onMockSearchChange: (value: unknown) => void;
  onRetry: () => void;
  onSelectChat: (chat: ChatSummary) => void;
  onOpenSettings: () => void;
};

export function ContactBrowser({
  providerVariant,
  enabled,
  status,
  contactsState,
  chatsCount,
  visibleChats,
  activeConnectionWarning,
  mockSearchQuery,
  onSimulateIncoming,
  onSimulateReaction,
  onSwitchSession,
  onSimulateError,
  onSimulateReconnect,
  onSimulateSendFailure,
  onSimulateMediaFailure,
  onSimulateDelay,
  onResetMockScenario,
  onMockSearchChange,
  onRetry,
  onSelectChat,
  onOpenSettings
}: ContactBrowserProps) {
  const chatsCountLoaded = contactsState === "loaded";

  return (
    <PanelSection title={`${providerVariant === "mock" ? "MOCK / OFFLINE · " : ""}Contacts (${visibleChats.length})`}>
      <div data-decky-provider={providerVariant} data-testid="decky-provider-ready" />
      {providerVariant === "mock" && <PanelSectionRow><div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <ButtonItem layout="below" onClick={onSimulateIncoming}>Simulate incoming message</ButtonItem>
        <ButtonItem layout="below" onClick={onSimulateReaction}>Simulate reaction to your message</ButtonItem>
        <ButtonItem layout="below" onClick={onSwitchSession}>Switch mock session</ButtonItem>
        <ButtonItem layout="below" onClick={onSimulateError}>Make mock bridge unavailable</ButtonItem>
        <ButtonItem layout="below" onClick={onSimulateReconnect}>Reconnect mock bridge</ButtonItem>
        <ButtonItem layout="below" onClick={onSimulateSendFailure}>Fail next mock send</ButtonItem>
        <ButtonItem layout="below" onClick={onSimulateMediaFailure}>Fail next mock image load</ButtonItem>
        <ButtonItem layout="below" onClick={() => onSimulateDelay(2000)}>Delay next mock response</ButtonItem>
        <ButtonItem layout="below" onClick={onResetMockScenario}>Reset mock data</ButtonItem>
      </div></PanelSectionRow>}
      {providerVariant === "mock" && <PanelSectionRow><TextField label="Search mock contacts" value={mockSearchQuery} onChange={onMockSearchChange} /></PanelSectionRow>}
      {activeConnectionWarning && <PanelSectionRow><div style={{ color: "#ffbd75", fontSize: "13px", padding: "8px 0" }}>{activeConnectionWarning}</div></PanelSectionRow>}
      {status === "qr_required" || status === "auth_failure" ? <PanelSectionRow><div style={{ color: "#ffbd75", padding: "12px 0" }}>WhatsApp needs authentication. Complete QR sign-in on the computer running the bridge.</div></PanelSectionRow>
        : contactsState === "loading" && chatsCount === 0 ? <PanelSectionRow><div style={{ opacity: 0.7, padding: "12px 0" }}>Loading conversations…</div></PanelSectionRow>
        : contactsState === "failed" && chatsCount === 0 ? <PanelSectionRow><div style={{ padding: "12px 0" }}><div style={{ opacity: 0.8 }}>Could not load conversations.</div><ButtonItem layout="below" onClick={onRetry}>Retry</ButtonItem></div></PanelSectionRow>
        : status !== "ready" && enabled && chatsCount === 0 ? <PanelSectionRow><div style={{ opacity: 0.7, padding: "12px 0" }}>Waiting for WhatsApp to become ready…</div></PanelSectionRow>
        : visibleChats.length === 0 && chatsCountLoaded ? <PanelSectionRow><div style={{ opacity: 0.7, padding: "12px 0" }}>No conversations match this setting.</div></PanelSectionRow>
        : null}
      {contactsState === "failed" && chatsCount > 0 && <PanelSectionRow><div style={{ opacity: 0.75, fontSize: "12px" }}>Showing saved conversations. Refresh failed. <ButtonItem layout="below" onClick={onRetry}>Retry</ButtonItem></div></PanelSectionRow>}
      {visibleChats.map((chat) => (
        <PanelSectionRow key={chat.chatId}>
          <div data-decky-chat-id={chat.chatId} data-testid={`mock-chat-${chat.chatId}`} data-decky-action={providerVariant === "mock" && chat.chatId === "mock-contact-ava" ? "open-ava" : undefined}>
          <ButtonItem layout="below" onClick={() => onSelectChat(chat)}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <ContactAvatar chat={chat} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}><strong title={chat.chatName} style={{ display: "block", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chat.chatName}</strong>{chat.unreadCount > 0 && <span aria-label={`${chat.unreadCount} unread ${chat.unreadCount === 1 ? "message" : "messages"}`} title={`${chat.unreadCount} unread ${chat.unreadCount === 1 ? "message" : "messages"}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, minWidth: "22px", height: "22px", padding: "0 6px", color: "#09251d", background: "#70e0b8", border: "1px solid #a2f4d7", borderRadius: "999px", fontSize: "11px", fontWeight: 800, lineHeight: 1 }}>{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</span>}</div>
                <div style={{ opacity: 0.62, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "3px" }}>{chat.lastMessage || "No recent message"}</div>
              </div>
              <span title={chat.timestamp > 0 ? new Date(chat.timestamp * 1000).toLocaleString() : undefined} style={{ flexShrink: 0, opacity: 0.65, fontSize: "12px", minWidth: "44px", textAlign: "right" }}>{formatChatTimestamp(chat.timestamp)}</span>
            </div>
          </ButtonItem>
          </div>
        </PanelSectionRow>
      ))}
      <PanelSectionRow><ButtonItem layout="below" onClick={onOpenSettings}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaCog /> Settings</span></ButtonItem></PanelSectionRow>
    </PanelSection>
  );
}
