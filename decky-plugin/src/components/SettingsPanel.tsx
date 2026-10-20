import { ButtonItem, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaArrowLeft, FaClock, FaFilter, FaSortAlphaDown, FaUsers } from "react-icons/fa";

export type ContactMode = "alphabetical" | "recent" | "last5" | "sinceSession";
export const reactionChoices = ["❤️", "👍", "😂", "😮", "😢", "🙏"] as const;
export type ReactionEmoji = typeof reactionChoices[number];

const contactModeLabels: Record<ContactMode, string> = {
  alphabetical: "Alphabetical",
  recent: "Most recent message",
  last5: "Last 5 people to message",
  sinceSession: "Messaged during this session"
};

const contactModeDescriptions: Record<ContactMode, string> = {
  alphabetical: "Show every saved chat from A to Z.",
  recent: "Show every saved chat with the newest activity first.",
  last5: "Keep the contacts list focused on the five latest conversations.",
  sinceSession: "Only show people who have messaged since this plugin session began."
};

type SettingsPanelProps = {
  providerLabel: string;
  notificationsEnabled: boolean;
  notificationSoundEnabled: boolean;
  notificationPreviewsEnabled: boolean;
  notificationsWhileGaming: boolean;
  reactionEmoji: ReactionEmoji;
  contactMode: ContactMode;
  compactHistory: boolean;
  onToggleNotifications: () => void;
  onToggleNotificationSound: () => void;
  onToggleNotificationPreviews: () => void;
  onToggleNotificationsWhileGaming: () => void;
  onSelectReaction: (emoji: ReactionEmoji) => void;
  onSelectContactMode: (mode: ContactMode) => void;
  onToggleCompactHistory: () => void;
  onOpenDiagnostics: () => void;
  onBack: () => void;
};

export function SettingsPanel({
  providerLabel,
  notificationsEnabled,
  notificationSoundEnabled,
  notificationPreviewsEnabled,
  notificationsWhileGaming,
  reactionEmoji,
  contactMode,
  compactHistory,
  onToggleNotifications,
  onToggleNotificationSound,
  onToggleNotificationPreviews,
  onToggleNotificationsWhileGaming,
  onSelectReaction,
  onSelectContactMode,
  onToggleCompactHistory,
  onOpenDiagnostics,
  onBack
}: SettingsPanelProps) {
  return (
    <PanelSection title="Settings">
      <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "4px 0 8px" }}>Choose how your {providerLabel} contacts are arranged.</div></PanelSectionRow>
      <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "8px 0 2px" }}>Notifications</div></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onToggleNotifications}><div style={{ textAlign: "left" }}><strong>{notificationsEnabled ? "✓ " : ""}Decky message notifications</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Show or suppress Decky notifications only. This does not disconnect the plugin or stop the PC bridge.</div></div></ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onToggleNotificationSound}><div style={{ textAlign: "left" }}><strong>{notificationSoundEnabled ? "✓ " : ""}Play notification sounds</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Play a sound with new message notifications.</div></div></ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onToggleNotificationPreviews}><div style={{ textAlign: "left" }}><strong>{notificationPreviewsEnabled ? "✓ " : ""}Show message previews</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Include the contact name and message text in notifications.</div></div></ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onToggleNotificationsWhileGaming}><div style={{ textAlign: "left" }}><strong>{notificationsWhileGaming ? "✓ " : ""}Notify while gaming</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Keep message notifications active after leaving this plugin.</div></div></ButtonItem></PanelSectionRow>
      <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "8px 0 2px" }}>Select default reaction (press x)</div></PanelSectionRow>
      {reactionChoices.map((emoji) => <PanelSectionRow key={emoji}><ButtonItem layout="below" onClick={() => onSelectReaction(emoji)}><span style={{ fontSize: "22px" }}>{reactionEmoji === emoji ? "✓ " : "  "}{emoji}</span></ButtonItem></PanelSectionRow>)}
      {(Object.keys(contactModeLabels) as ContactMode[]).map((mode) => (
        <PanelSectionRow key={mode}>
          <ButtonItem layout="below" onClick={() => onSelectContactMode(mode)}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
              {mode === "alphabetical" ? <FaSortAlphaDown /> : mode === "recent" ? <FaClock /> : mode === "last5" ? <FaFilter /> : <FaUsers />}
              <div style={{ flex: 1 }}><div><strong>{contactMode === mode ? "✓ " : ""}{contactModeLabels[mode]}</strong></div><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>{contactModeDescriptions[mode]}</div></div>
            </div>
          </ButtonItem>
        </PanelSectionRow>
      ))}
      <PanelSectionRow><ButtonItem layout="below" onClick={onToggleCompactHistory}><div style={{ display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}><FaClock /><div><div><strong>{compactHistory ? "✓ " : ""}Show only the last 5 messages</strong></div><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Keep conversations compact and load older messages on demand.</div></div></div></ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onOpenDiagnostics}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}>Diagnostics</span></ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={onBack}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to contacts</span></ButtonItem></PanelSectionRow>
    </PanelSection>
  );
}
