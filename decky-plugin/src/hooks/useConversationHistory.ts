import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { provider } from "../providers/provider-selected";
import { uniqueReactions } from "../messages/reactions";
import {
  compareHistoryMessages,
  getHistoryExpansionFocusId,
  getNextHistoryLimit,
  HistoryRequestLifecycle,
  INITIAL_COMPACT_HISTORY_LIMIT,
  mergeHistorySnapshot,
  RecentLiveMessageCache
} from "../messages/history";
import type { ChatSummary } from "../types/chat";
import type { IncomingMessage } from "../types/message";
import type { ReplyTarget } from "../types/conversation";

function hasMediaFallbackBody(body: string): boolean {
  return ["[Image]", "[Sticker]", "[GIF]", "[Voice message]", "[Video]"].includes(body.trim());
}

type UseConversationHistoryOptions = {
  panelMounted: { current: boolean };
  uncertainDeliveryIds: { current: Set<string> };
  compactHistory: boolean;
  setChats: Dispatch<SetStateAction<ChatSummary[]>>;
  setOwnReactions: Dispatch<SetStateAction<Record<string, string | null>>>;
  setSelectedMessageId: Dispatch<SetStateAction<string>>;
  setReplyTarget: Dispatch<SetStateAction<ReplyTarget | undefined>>;
  setFocusedMessageId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  reportError: (message: string) => void;
};

export type ConversationRestoreSnapshot = {
  chat: ChatSummary;
  history: IncomingMessage[];
  historyLimit: number;
  historyHasMore: boolean;
  focusedMessageId: string;
};

export function useConversationHistory({
  panelMounted,
  uncertainDeliveryIds,
  compactHistory,
  setChats,
  setOwnReactions,
  setSelectedMessageId,
  setReplyTarget,
  setFocusedMessageId,
  setError,
  reportError
}: UseConversationHistoryOptions) {
  const [selectedChat, setSelectedChat] = useState<ChatSummary | undefined>();
  const [selectedChatId, setSelectedChatId] = useState("");
  const [history, setHistory] = useState<IncomingMessage[]>([]);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(INITIAL_COMPACT_HISTORY_LIMIT);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyAppliedVersion, setHistoryAppliedVersion] = useState(0);

  const selectedChatIdRef = useRef("");
  const pendingContactFocusId = useRef("");
  const recentLiveMessages = useRef(new RecentLiveMessageCache());
  const historyExpansionPending = useRef(false);
  const historyExpansionBoundary = useRef<string | undefined>(undefined);
  const historyExpansionFocus = useRef<{ chatId: string; conversationRun: number; messageId: string } | undefined>(undefined);
  const scrollOnOpen = useRef<{ chatId: string; conversationRun: number; baselineVersion: number } | null>(null);
  const historyAppliedConversationRun = useRef<number | undefined>(undefined);
  const historyRequest = useRef<AbortController | undefined>(undefined);
  const historyRequestLifecycle = useRef(new HistoryRequestLifecycle());
  const conversationRun = useRef(0);
  const historyRevision = useRef(0);
  const bridgeSessionEstablished = useRef(false);

  selectedChatIdRef.current = selectedChatId;

  const abortHistory = useCallback(() => {
    historyRequestLifecycle.current.invalidate();
    historyRequest.current?.abort();
  }, []);

  const invalidateSession = useCallback((sessionId: string) => {
    const previousSessionId = recentLiveMessages.current.sessionId;
    const sessionChanged = recentLiveMessages.current.setSession(sessionId);
    const wasEstablished = bridgeSessionEstablished.current;
    bridgeSessionEstablished.current = true;
    if (!sessionChanged && wasEstablished) return { previousSessionId, sessionChanged, wasEstablished };

    abortHistory();
    historyRevision.current += 1;
    historyExpansionPending.current = false;
    historyExpansionBoundary.current = undefined;
    historyExpansionFocus.current = undefined;
    if (previousSessionId && sessionId && previousSessionId !== sessionId) {
      setHistory([]);
      setHistoryHasMore(false);
    }
    if (selectedChatIdRef.current) {
      setHistoryLoading(true);
      setHistoryRefresh((current) => current + 1);
    } else {
      setHistoryLoading(false);
    }
    return { previousSessionId, sessionChanged, wasEstablished };
  }, [abortHistory]);

  const invalidateHistory = () => {
    historyRequestLifecycle.current.invalidate();
    historyRevision.current += 1;
    historyRequest.current?.abort();
    historyExpansionPending.current = false;
    historyExpansionBoundary.current = undefined;
    historyExpansionFocus.current = undefined;
  };

  const loadHistory = async (chatId: string, limit = compactHistory ? historyLimit : 50, isExpansion = false, previousBoundaryId?: string) => {
    if (!panelMounted.current || selectedChatIdRef.current !== chatId) return false;
    if (historyExpansionPending.current && !isExpansion) return false;
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    const requestGeneration = historyRequestLifecycle.current.begin();
    const requestConversationRun = conversationRun.current;
    const sessionId = recentLiveMessages.current.sessionId;
    const revision = historyRevision.current;
    try {
      const response = await provider.request("history", { chatId, limit }, controller.signal);
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(`History request failed (${response.status}): ${details?.error || "unknown bridge error"}`);
      }
      const result = await response.json() as { messages: IncomingMessage[]; hasMore?: boolean };
      if (controller.signal.aborted || !panelMounted.current || selectedChatIdRef.current !== chatId
        || conversationRun.current !== requestConversationRun
        || !bridgeSessionEstablished.current || !recentLiveMessages.current.isCurrentSession(sessionId)) return false;
      if (historyRevision.current !== revision) {
        setHistoryRefresh((current) => current + 1);
        return false;
      }
      const messages = result.messages.map((message) => ({
        ...message,
        reactions: uniqueReactions(message.reactions),
        deliveryUncertain: message.deliveryUncertain || uncertainDeliveryIds.current.has(message.id),
        mediaLoadState: message.media || message.image ? undefined
          : message.mediaKind || hasMediaFallbackBody(message.body) ? "unavailable" as const
            : undefined
      }));
      setOwnReactions((current) => {
        const updated = { ...current };
        for (const message of messages) updated[message.id] = message.reaction || null;
        return updated;
      });
      setHistory((current) => {
        if (!recentLiveMessages.current.isCurrentSession(sessionId)) return current;
        const existingById = new Map(current.map((message) => [message.id, message]));
        const hydratedMessages = messages.map((message) => {
          const existing = existingById.get(message.id);
          const hasUnavailableMedia = !message.media && !message.image && Boolean(
            message.mediaKind || hasMediaFallbackBody(message.body) || existing?.mediaKind || existing?.media
            || existing?.image || existing?.mediaLoadState === "loading"
          );
          return { ...message, mediaLoadState: hasUnavailableMedia ? "unavailable" as const : undefined };
        });
        return mergeHistorySnapshot(hydratedMessages, [
          ...recentLiveMessages.current.values(),
          ...current.filter((message) => message.chatId === chatId && message.id.startsWith("local-failed-"))
        ], chatId);
      });
      setHistoryHasMore(Boolean(result.hasMore));
      if (isExpansion) {
        setHistoryLimit(limit);
        const focusId = previousBoundaryId === undefined
          ? undefined
          : getHistoryExpansionFocusId(messages, previousBoundaryId);
        historyExpansionFocus.current = focusId
          ? { chatId, conversationRun: requestConversationRun, messageId: focusId }
          : undefined;
      }
      historyAppliedConversationRun.current = requestConversationRun;
      setHistoryAppliedVersion((current) => current + 1);
      if (historyExpansionPending.current) {
        historyExpansionPending.current = false;
        historyExpansionBoundary.current = undefined;
        setHistoryLoading(false);
      }
      return true;
    } catch (historyError) {
      if (!controller.signal.aborted) throw historyError;
      return false;
    } finally {
      if (panelMounted.current && historyRequestLifecycle.current.isCurrent(requestGeneration)) setHistoryLoading(false);
      if (historyRequest.current === controller) historyRequest.current = undefined;
    }
  };

  const selectChat = async (chat: ChatSummary) => {
    const run = ++conversationRun.current;
    historyExpansionPending.current = false;
    historyExpansionBoundary.current = undefined;
    historyExpansionFocus.current = undefined;
    scrollOnOpen.current = { chatId: chat.chatId, conversationRun: run, baselineVersion: historyAppliedVersion };
    selectedChatIdRef.current = chat.chatId;
    setSelectedMessageId("");
    setReplyTarget(undefined);
    setSelectedChat(chat);
    setSelectedChatId(chat.chatId);
    setHistory([]);
    const initialHistoryLimit = compactHistory ? INITIAL_COMPACT_HISTORY_LIMIT : 50;
    setHistoryLimit(initialHistoryLimit);
    setHistoryHasMore(false);
    setFocusedMessageId("");
    setHistoryLoading(true);
    setError("");
    try {
      await loadHistory(chat.chatId, initialHistoryLimit);
      if (conversationRun.current !== run || selectedChatIdRef.current !== chat.chatId || !panelMounted.current) return;
      void provider.request("read", { chatId: chat.chatId })
        .then(async (response) => {
          if (!response.ok) throw new Error(`mark-read request failed (${response.status})`);
          const result = await response.json() as { marked?: boolean };
          if (!result.marked) throw new Error("WhatsApp did not confirm the conversation was read");
          if (selectedChatIdRef.current === chat.chatId && panelMounted.current) {
            setChats((current) => current.map((item) => item.chatId === chat.chatId ? { ...item, unreadCount: 0 } : item));
          }
        })
        .catch(() => console.warn("[decky-whatsapp] could not mark conversation as read"));
    } catch {
      if (conversationRun.current === run && panelMounted.current) reportError("Unable to load conversation history");
    } finally {
      if (conversationRun.current === run && panelMounted.current) setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!selectedChatId || historyLoading || historyExpansionPending.current) return;
    const nextLimit = getNextHistoryLimit(historyLimit, historyHasMore);
    if (nextLimit === undefined) return;
    const run = conversationRun.current;
    const previousBoundaryId = history.slice(-historyLimit)[0]?.id;
    historyExpansionBoundary.current = previousBoundaryId;
    historyExpansionFocus.current = undefined;
    historyExpansionPending.current = true;
    setHistoryLoading(true);
    try {
      const loaded = await loadHistory(selectedChatId, nextLimit, true, previousBoundaryId);
      if (!loaded && conversationRun.current === run && panelMounted.current
        && historyExpansionPending.current && historyExpansionBoundary.current === previousBoundaryId) {
        historyExpansionPending.current = false;
        historyExpansionBoundary.current = undefined;
        historyExpansionFocus.current = undefined;
        setHistoryLoading(false);
      }
    } catch {
      if (conversationRun.current !== run || !panelMounted.current
        || !historyExpansionPending.current || historyExpansionBoundary.current !== previousBoundaryId) return;
      setHistory((current) => current.map((message) => message.mediaLoadState === "loading"
        ? { ...message, mediaLoadState: "unavailable" }
        : message));
      reportError("Older messages could not be loaded");
      historyExpansionPending.current = false;
      historyExpansionBoundary.current = undefined;
      historyExpansionFocus.current = undefined;
      setHistoryLoading(false);
    } finally {
      if (conversationRun.current === run && panelMounted.current && !historyExpansionPending.current) setHistoryLoading(false);
    }
  };

  const retryMediaLoad = (messageId: string) => {
    setHistory((current) => current.map((message) => message.id === messageId
      ? { ...message, mediaLoadState: "loading" }
      : message));
    setHistoryRefresh((current) => current + 1);
  };

  const markMediaUnavailable = (messageId: string) => {
    setHistory((current) => current.map((message) => message.id === messageId
      ? { ...message, mediaLoadState: "unavailable" }
      : message));
  };

  const closeConversation = () => {
    pendingContactFocusId.current = selectedChatIdRef.current;
    historyExpansionPending.current = false;
    historyExpansionBoundary.current = undefined;
    historyExpansionFocus.current = undefined;
    conversationRun.current += 1;
    scrollOnOpen.current = null;
    selectedChatIdRef.current = "";
    historyRequest.current?.abort();
    setSelectedChat(undefined);
    setSelectedChatId("");
    setHistory([]);
    setHistoryLimit(INITIAL_COMPACT_HISTORY_LIMIT);
    setHistoryHasMore(false);
    setFocusedMessageId("");
    setSelectedMessageId("");
    setReplyTarget(undefined);
  };

  const restoreConversation = (snapshot: ConversationRestoreSnapshot) => {
    abortHistory();
    const run = ++conversationRun.current;
    selectedChatIdRef.current = snapshot.chat.chatId;
    historyExpansionPending.current = false;
    historyExpansionBoundary.current = undefined;
    historyExpansionFocus.current = snapshot.focusedMessageId
      ? { chatId: snapshot.chat.chatId, conversationRun: run, messageId: snapshot.focusedMessageId }
      : undefined;
    scrollOnOpen.current = null;
    setSelectedChat(snapshot.chat);
    setSelectedChatId(snapshot.chat.chatId);
    setHistory(snapshot.history);
    setHistoryLimit(snapshot.historyLimit);
    setHistoryHasMore(snapshot.historyHasMore);
    setHistoryLoading(false);
    setHistoryAppliedVersion((current) => current + 1);
    setOwnReactions(Object.fromEntries(snapshot.history.map((message) => [message.id, message.reaction || null])));
  };

  const clearForDisconnect = () => {
    setSelectedChat(undefined);
    setSelectedChatId("");
    selectedChatIdRef.current = "";
    setHistory([]);
  };

  return {
    selectedChat, selectedChatId, selectedChatIdRef, pendingContactFocusId,
    history, setHistory, historyRefresh, setHistoryRefresh, historyLoading, setHistoryLoading,
    historyLimit, historyHasMore,
    historyAppliedVersion,
    historyExpansionPending, historyExpansionBoundary, historyExpansionFocus, scrollOnOpen, historyAppliedConversationRun,
    recentLiveMessages, conversationRun, historyRevision, bridgeSessionEstablished,
    invalidateSession, invalidateHistory, abortHistory, loadHistory, selectChat,
    loadMoreHistory, retryMediaLoad, markMediaUnavailable, closeConversation, clearForDisconnect, restoreConversation
  };
}
