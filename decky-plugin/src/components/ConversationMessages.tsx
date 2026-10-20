import { Fragment } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ButtonItem, PanelSectionRow } from "@decky/ui";
import { FaArrowLeft } from "react-icons/fa";
import { ContactAvatar } from "./ContactAvatar";
import { MessageBubble } from "./MessageBubble";
import { uniqueReactions } from "../messages/reactions";
import { getMessageStatus } from "../messages/message-status";
import type { ChatSummary } from "../types/chat";
import type { IncomingMessage } from "../types/message";

type ConversationMessagesProps = {
  selectedChat?: ChatSummary;
  historyLength: number;
  historyLoading: boolean;
  historyExpansionPending: boolean;
  compactHistory: boolean;
  nextHistoryLimit: number | undefined;
  historyHasMore: boolean;
  historyLimit: number;
  displayedHistory: IncomingMessage[];
  selectedMessageId: string;
  onCloseConversation: () => void;
  onLoadMore: () => void;
  onFocusMessage: (messageId: string) => void;
  onSelectMessage: (messageId: string) => void;
  onMessageYPress: (messageId: string) => boolean;
  renderMedia: (message: IncomingMessage) => ReactNode;
};

export function ConversationMessages({
  selectedChat,
  historyLength,
  historyLoading,
  historyExpansionPending,
  compactHistory,
  nextHistoryLimit,
  historyHasMore,
  historyLimit,
  displayedHistory,
  selectedMessageId,
  onCloseConversation,
  onLoadMore,
  onFocusMessage,
  onSelectMessage,
  onMessageYPress,
  renderMedia
}: ConversationMessagesProps) {
  return <>
    <PanelSectionRow><div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "2px 0 8px" }}>{selectedChat && <ContactAvatar chat={selectedChat} size={38} />}<div style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedChat?.chatName || "Conversation"}</strong><span style={{ opacity: 0.6, fontSize: "12px" }}>{historyLength} messages</span></div></div></PanelSectionRow>
    <PanelSectionRow><div style={{ opacity: 0.65, fontSize: "12px" }}>A: open/select · B: back · D-pad: navigate · Select a message for actions · X: react · Y: toggle audio/video playback (images stay inline) · Steam+X: keyboard</div></PanelSectionRow>
    <PanelSectionRow><ButtonItem layout="below" onClick={onCloseConversation}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to contacts</span></ButtonItem></PanelSectionRow>
    {historyLoading && <PanelSectionRow><div style={{ opacity: 0.7 }}>{historyExpansionPending ? "Loading older messages…" : "Loading conversation…"}</div></PanelSectionRow>}
    {!historyLoading && historyLength === 0 && <PanelSectionRow><div style={{ opacity: 0.7 }}>No message history</div></PanelSectionRow>}
    {!historyLoading && compactHistory && nextHistoryLimit !== undefined && <PanelSectionRow><ButtonItem layout="below" onClick={onLoadMore}><span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>Load more messages</span></ButtonItem></PanelSectionRow>}
    {!historyLoading && compactHistory && historyHasMore && nextHistoryLimit === undefined && <PanelSectionRow><div style={{ opacity: 0.65, fontSize: "12px" }}>History limit reached ({historyLimit} messages).</div></PanelSectionRow>}
    {displayedHistory.map((message) => (
      <Fragment key={message.id}>
        <PanelSectionRow>
          <div data-decky-message-id={message.id} onFocusCapture={() => { onFocusMessage(message.id); }} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key.toLowerCase() !== "y") return;
            if (message.media?.kind === "image") {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (!onMessageYPress(message.id)) return;
            event.preventDefault();
            event.stopPropagation();
          }} style={{ width: "100%" }}>
            <ButtonItem layout="below" onClick={() => { onFocusMessage(message.id); onSelectMessage(message.id); }}>
              <MessageBubble
                message={message}
                selected={selectedMessageId === message.id}
                reactions={uniqueReactions(message.reactions && message.reactions.length > 0 ? message.reactions : message.reaction ? [message.reaction] : undefined)}
                status={message.fromMe ? getMessageStatus(message.ack, message.deliveryUncertain) : undefined}
                timestamp={new Date(message.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              >
                {renderMedia(message)}
              </MessageBubble>
            </ButtonItem>
            {message.sendFailureNotice && <div role="alert" style={{ margin: "4px 8px 0", color: "#ff9b9b", fontSize: "12px", lineHeight: 1.3, textAlign: message.fromMe ? "right" : "left" }}>{message.sendFailureNotice}</div>}
          </div>
        </PanelSectionRow>
      </Fragment>
    ))}
  </>;
}
