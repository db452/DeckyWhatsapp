import { toaster } from "@decky/api";
import { useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { provider } from "../providers/provider-selected";
import { compareHistoryMessages } from "../messages/history";
import { uniqueReactions } from "../messages/reactions";
import type { ChatSummary } from "../types/chat";
import type { IncomingMessage } from "../types/message";
import type { ReplyTarget } from "../types/conversation";

type UseConversationActionsOptions = {
  selectedChatId: string;
  selectedChat?: ChatSummary;
  reply: string;
  replyTarget?: ReplyTarget;
  selectedMessageId: string;
  reactionEmoji: string;
  compactHistory: boolean;
  historyLimit: number;
  panelMounted: { current: boolean };
  conversationRun: { current: number };
  uncertainDeliveryIds: { current: Set<string> };
  setUncertainDeliveryIds: Dispatch<SetStateAction<Set<string>>>;
  replyFieldContainerRef: RefObject<HTMLDivElement | null>;
  setHistory: Dispatch<SetStateAction<IncomingMessage[]>>;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setReply: Dispatch<SetStateAction<string>>;
  setReplyTarget: Dispatch<SetStateAction<ReplyTarget | undefined>>;
  setSelectedMessageId: Dispatch<SetStateAction<string>>;
  setOwnReactions: Dispatch<SetStateAction<Record<string, string | null>>>;
  setError: Dispatch<SetStateAction<string>>;
  reportError: (message: string) => void;
  loadHistory: (chatId: string, limit?: number) => Promise<boolean>;
};

export function useConversationActions({
  selectedChatId,
  selectedChat,
  reply,
  replyTarget,
  selectedMessageId,
  reactionEmoji,
  compactHistory,
  historyLimit,
  panelMounted,
  conversationRun,
  uncertainDeliveryIds,
  setUncertainDeliveryIds,
  replyFieldContainerRef,
  setHistory,
  setHistoryLoading,
  setReply,
  setReplyTarget,
  setSelectedMessageId,
  setOwnReactions,
  setError,
  reportError,
  loadHistory
}: UseConversationActionsOptions) {
  const [sending, setSending] = useState(false);
  const [messageActionId, setMessageActionId] = useState("");
  const sendInFlight = useRef(false);
  const actionInFlight = useRef(false);

  const sendReply = async () => {
    if (!selectedChatId || !reply.trim() || sendInFlight.current) return;
    sendInFlight.current = true;
    setSending(true);
    const chatId = selectedChatId;
    const run = conversationRun.current;
    const stillActive = () => panelMounted.current && conversationRun.current === run;
    const body = reply.trim();
    const draft = reply;
    const chatName = selectedChat?.chatName || "Conversation";
    const quotedMessageId = replyTarget?.id;
    setError("");
    console.log("[decky-whatsapp] sending reply", { chatId, quotedMessageId, bodyLength: body.length });
    let receivedHttpResponse = false;
    try {
      try {
        const response = await provider.request("send", { chatId, body, quotedMessageId });
        receivedHttpResponse = true;
        if (!response.ok) {
          const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
          throw new Error(details?.error || `send failed (${response.status})`);
        }
      } catch {
        const uncertain = !receivedHttpResponse;
        const message = uncertain
          ? "No send confirmation received. Delivery is uncertain; check WhatsApp before retrying."
          : "Message could not be sent";
        const failureNotice = uncertain
          ? "No send confirmation received. Delivery is uncertain; check WhatsApp before retrying."
          : "Message could not be sent. You can retry this message.";
        console.error("[decky-whatsapp] send failed");
        if (!stillActive()) return;
        reportError(message);
        setHistory((current) => [...current, {
          id: `local-failed-${Date.now()}`,
          chatId,
          chatName,
          sender: "You",
          body,
          timestamp: Math.floor(Date.now() / 1000),
          fromMe: true,
          sendFailureNotice: failureNotice,
          quotedMessageId,
          deliveryUncertain: uncertain,
          ack: -1
        }].sort(compareHistoryMessages));
        return;
      }

      if (!stillActive()) return;
      setReply((current) => current === draft ? "" : current);
      setReplyTarget((current) => current?.id === quotedMessageId ? undefined : current);
      setSelectedMessageId((current) => current === selectedMessageId ? "" : current);
      setHistoryLoading(true);
      try {
        await loadHistory(chatId, compactHistory ? historyLimit : 50);
      } catch {
        if (stillActive()) reportError("Message was sent, but the conversation could not be refreshed");
      } finally {
        if (stillActive()) setHistoryLoading(false);
      }
    } finally {
      sendInFlight.current = false;
      if (panelMounted.current) {
        setSending(false);
        if (stillActive()) {
          window.requestAnimationFrame(() => {
            if (!stillActive()) return;
            const field = replyFieldContainerRef.current?.querySelector<HTMLElement>("input, textarea, [contenteditable=\"true\"]");
            field?.focus({ preventScroll: true });
          });
        }
      }
    }
  };

  const retryMessage = async (message: IncomingMessage) => {
    if (!selectedChatId || !message.fromMe || message.ack !== -1 || message.deliveryUncertain || uncertainDeliveryIds.current.has(message.id) || actionInFlight.current) return;
    actionInFlight.current = true;
    const run = conversationRun.current;
    setMessageActionId(message.id);
    setError("");
    let receivedHttpResponse = false;
    try {
      const response = await provider.request("send", { chatId: message.chatId, body: message.body, quotedMessageId: message.quotedMessageId });
      receivedHttpResponse = true;
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(details?.error || `retry failed (${response.status})`);
      }
      if (!panelMounted.current || conversationRun.current !== run) return;
      setHistory((current) => current.filter((currentMessage) => currentMessage.id !== message.id));
      await loadHistory(selectedChatId, compactHistory ? historyLimit : 50);
    } catch (retryError) {
      if (panelMounted.current && !receivedHttpResponse) {
        const uncertainIds = new Set(uncertainDeliveryIds.current);
        uncertainIds.add(message.id);
        uncertainDeliveryIds.current = uncertainIds;
        setUncertainDeliveryIds(uncertainIds);
      }
      if (panelMounted.current && conversationRun.current === run) {
        if (!receivedHttpResponse) {
          setHistory((current) => current.map((currentMessage) => currentMessage.id === message.id
            ? {
              ...currentMessage,
              deliveryUncertain: true,
              sendFailureNotice: "No retry confirmation received. Delivery is uncertain; check WhatsApp before retrying."
            }
            : currentMessage));
          reportError("No retry confirmation received. Delivery is uncertain; check WhatsApp before retrying.");
        } else {
          reportError(retryError instanceof Error ? retryError.message : "Message could not be retried");
        }
      }
    } finally {
      actionInFlight.current = false;
      if (panelMounted.current) setMessageActionId("");
    }
  };

  const deleteMessage = async (message: IncomingMessage) => {
    if (!selectedChatId || !message.fromMe || actionInFlight.current) return;
    actionInFlight.current = true;
    const run = conversationRun.current;
    setMessageActionId(message.id);
    setError("");
    try {
      const response = await provider.request("delete", { chatId: message.chatId, messageId: message.id });
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(details?.error || `delete failed (${response.status})`);
      }
      if (!panelMounted.current || conversationRun.current !== run) return;
      setHistory((current) => current.map((currentMessage) => currentMessage.id === message.id
        ? { ...currentMessage, body: "[Message deleted]", mediaKind: undefined, image: undefined, media: undefined, reaction: undefined, reactions: undefined }
        : currentMessage));
      setReplyTarget((current) => current?.id === message.id ? undefined : current);
      setSelectedMessageId((current) => current === message.id ? "" : current);
      toaster.toast({ title: provider.label, body: "Message deleted", duration: 2500 });
    } catch (deleteError) {
      if (panelMounted.current && conversationRun.current === run) reportError(deleteError instanceof Error ? deleteError.message : "Message could not be deleted");
    } finally {
      actionInFlight.current = false;
      if (panelMounted.current) setMessageActionId("");
    }
  };

  const reactToMessage = async (chatId: string, messageId: string, emoji: string = reactionEmoji) => {
    const run = conversationRun.current;
    const stillActive = () => panelMounted.current && conversationRun.current === run && selectedChatId === chatId;
    try {
      const response = await provider.request("react", { chatId, messageId, emoji });
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(details?.error || `reaction failed (${response.status})`);
      }
      if (!stillActive()) return;
      await loadHistory(chatId, compactHistory ? historyLimit : 50);
      if (!stillActive()) return;
      setOwnReactions((current) => ({ ...current, [messageId]: emoji || null }));
      setHistory((current) => current.map((message) => {
        if (message.id !== messageId) return message;
        const otherReactions = (message.reactions || []).filter((reaction) => reaction !== reactionEmoji && reaction !== emoji);
        const reactions = emoji ? [...otherReactions, emoji] : otherReactions;
        return { ...message, reaction: emoji || undefined, reactions: uniqueReactions(reactions) };
      }));
    } catch {
      if (!stillActive()) return;
      console.error("[decky-whatsapp] reaction failed");
      reportError("Reaction could not be sent");
    }
  };

  return { sending, messageActionId, setMessageActionId, sendReply, retryMessage, deleteMessage, reactToMessage };
}
