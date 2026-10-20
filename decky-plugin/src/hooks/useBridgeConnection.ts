import { useEffect, useRef, useState } from "react";
import { provider } from "../providers/provider-selected";
import type { BridgeEvent, BridgeStatus, ProviderConnection } from "../providers/provider";
import type { BridgeHttpState, BridgeSocketState } from "../connection/connection-state";
import { createQueuedRequest, createRevisionGuard } from "../messages/sync-helpers";
import { uniqueReactions } from "../messages/reactions";
import { compareHistoryMessages, RecentLiveMessageCache } from "../messages/history";
import type { ChatSummary } from "../types/chat";
import type { IncomingMessage } from "../types/message";
import type { ContactsState } from "../components/ContactBrowser";

type UseBridgeConnectionOptions = {
  enabled: boolean;
  selectedChatId: string;
  selectedChatIdRef: { current: string };
  historyRevision: { current: number };
  recentLiveMessages: { current: RecentLiveMessageCache };
  bridgeSessionEstablished: { current: boolean };
  setChats: React.Dispatch<React.SetStateAction<ChatSummary[]>>;
  setHistory: React.Dispatch<React.SetStateAction<IncomingMessage[]>>;
  setHistoryRefresh: React.Dispatch<React.SetStateAction<number>>;
  setOwnReactions: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  setContactsState: React.Dispatch<React.SetStateAction<ContactsState>>;
  clearForDisconnect: () => void;
  adoptBridgeSession: (sessionId: string) => void;
  subscribe: typeof provider.subscribe;
  profileChatIds: string;
  showSettings: boolean;
  showDiagnostics: boolean;
  reportConnectionWarning: (message: string) => void;
};

export function useBridgeConnection({
  enabled,
  selectedChatId,
  selectedChatIdRef,
  historyRevision,
  recentLiveMessages,
  bridgeSessionEstablished,
  setChats,
  setHistory,
  setHistoryRefresh,
  setOwnReactions,
  setContactsState,
  clearForDisconnect,
  adoptBridgeSession,
  subscribe,
  profileChatIds,
  showSettings,
  showDiagnostics,
  reportConnectionWarning
}: UseBridgeConnectionOptions) {
  const [status, setStatus] = useState<BridgeStatus>("unknown");
  const [socketState, setSocketState] = useState<BridgeSocketState>("unknown");
  const [httpState, setHttpState] = useState<BridgeHttpState>("unknown");
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<number>();
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<number>();
  const [bridgeSessionId, setBridgeSessionId] = useState("");
  const [connectionRefresh, setConnectionRefresh] = useState(0);
  const bridgeHealthFailures = useRef(0);
  const profilePicCache = useRef<Record<string, string | null>>({});

  const updateStatus = (nextStatus: BridgeStatus) => {
    setStatus(nextStatus);
    setStatusUpdatedAt(Date.now());
  };

  const requestReconnect = () => {
    bridgeHealthFailures.current = 0;
    setSocketState("connecting");
    setHttpState("connecting");
    setConnectionRefresh((current) => current + 1);
  };

  // Avatar updates must not cancel and restart all four workers.
  useEffect(() => {
    if (!enabled || status !== "ready" || selectedChatId || showSettings || showDiagnostics) return;
    let cancelled = false;
    const controller = new AbortController();
    const profileQueue = JSON.parse(profileChatIds) as string[];
    const pendingProfilePics = new Map<string, string>();
    let profileFlushTimer: number | undefined;
    const flushProfileUpdates = () => {
      if (profileFlushTimer !== undefined) {
        window.clearTimeout(profileFlushTimer);
        profileFlushTimer = undefined;
      }
      if (cancelled || pendingProfilePics.size === 0) return;
      const batch = new Map(pendingProfilePics);
      pendingProfilePics.clear();
      setChats((current) => current.map((chat) => {
        const profilePicUrl = batch.get(chat.chatId);
        return profilePicUrl ? { ...chat, profilePicUrl } : chat;
      }));
    };
    setChats((current) => current.map((chat) => profilePicCache.current[chat.chatId]
      ? { ...chat, profilePicUrl: profilePicCache.current[chat.chatId]! } : chat));
    const loadProfiles = async () => {
      while (!cancelled) {
        const chatId = profileQueue.shift();
        if (!chatId) return;
        if (Object.prototype.hasOwnProperty.call(profilePicCache.current, chatId)) continue;
        try {
          const profileResponse = await provider.request("profile", { chatId }, controller.signal);
          if (!profileResponse.ok) continue;
          const profile = await profileResponse.json() as { profilePicUrl?: string | null };
          profilePicCache.current[chatId] = profile.profilePicUrl || null;
          if (cancelled || !profile.profilePicUrl) continue;
          pendingProfilePics.set(chatId, profile.profilePicUrl);
          if (pendingProfilePics.size >= 8) {
            flushProfileUpdates();
          } else if (profileFlushTimer === undefined) {
            profileFlushTimer = window.setTimeout(flushProfileUpdates, 100);
          }
        } catch {
          // Profile pictures are optional and must not affect synchronization.
        }
      }
    };
    void Promise.all(Array.from({ length: 4 }, () => loadProfiles())).then(flushProfileUpdates);
    return () => {
      cancelled = true;
      if (profileFlushTimer !== undefined) window.clearTimeout(profileFlushTimer);
      pendingProfilePics.clear();
      controller.abort();
    };
  }, [enabled, status, profileChatIds, selectedChatId, showSettings, showDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    let healthLoading = false;
    const controller = new AbortController();
    bridgeSessionEstablished.current = false;
    if (!enabled) {
      updateStatus("disabled");
      setSocketState("disabled");
      setHttpState("disabled");
      setChats([]);
      setContactsState("idle");
      clearForDisconnect();
      return () => {
        cancelled = true;
      };
    }

    const chatsRevision = createRevisionGuard();
    const loadChats = createQueuedRequest(async () => {
      if (cancelled) return;
      const snapshotRevision = chatsRevision.capture();
      setContactsState((current) => current === "loaded" ? current : "loading");
      try {
        const response = await provider.request("chats", {}, controller.signal);
        if (!response.ok) throw new Error(`contacts request failed (${response.status})`);
        const result = await response.json() as { chats: ChatSummary[]; hasMore?: boolean };
        console.log("[decky-whatsapp] contacts response", { count: result.chats?.length ?? 0 });
        if (!cancelled && chatsRevision.isCurrent(snapshotRevision)) {
          setChats(result.chats.map((chat) => ({
            ...chat,
            profilePicUrl: profilePicCache.current[chat.chatId] || undefined
          })));
          setContactsState("loaded");
        } else if (!cancelled) {
          // A live event beat this snapshot; queue a fresh one after it settles.
          void loadChats();
        }
      } catch {
        if (cancelled) return;
        console.error("[decky-whatsapp] contacts request failed");
        setContactsState("failed");
      }
    });

    const refreshBridgeStatus = async () => {
      if (cancelled || healthLoading) return;
      healthLoading = true;
      try {
        const response = await provider.request("health", {}, controller.signal);
        if (!response.ok) throw new Error(`health check failed (${response.status})`);
        const health = await response.json() as { status: BridgeStatus; sessionId?: string };
        if (!cancelled) {
          bridgeHealthFailures.current = 0;
          setHttpState("connected");
          updateStatus(health.status);
          if (typeof health.sessionId === "string" && health.sessionId) {
            adoptBridgeSession(health.sessionId);
            setBridgeSessionId(health.sessionId);
          }
          setLastHealthCheckAt(Date.now());
        }
      } catch {
        if (!cancelled) {
          bridgeHealthFailures.current += 1;
          setHttpState("disconnected");
          if (bridgeHealthFailures.current >= 3) {
            updateStatus("unknown");
            reportConnectionWarning("Computer unavailable. Retrying connection…");
          }
        }
      } finally {
        healthLoading = false;
      }
    };

    const addMessage = (incoming: IncomingMessage) => {
      // Live message events omit media bytes; the following history refresh hydrates them.
      chatsRevision.invalidate();
      const messageWithMediaState = incoming.mediaKind && !incoming.media
        ? { ...incoming, mediaLoadState: "loading" as const }
        : incoming;
      recentLiveMessages.current.remember(messageWithMediaState);
      setChats((current) => {
        const existing = current.find((chat) => chat.chatId === incoming.chatId);
        const isLatestActivity = !existing || incoming.timestamp >= existing.timestamp;
        const updated: ChatSummary = {
          chatId: incoming.chatId,
          chatName: incoming.chatName,
          profilePicUrl: existing?.profilePicUrl,
          receivedSinceSession: existing?.receivedSinceSession || !incoming.fromMe,
          lastMessage: isLatestActivity ? incoming.body : existing.lastMessage,
          timestamp: Math.max(existing?.timestamp ?? 0, incoming.timestamp),
          unreadCount: existing
            ? existing.unreadCount + (incoming.fromMe || incoming.chatId === selectedChatIdRef.current ? 0 : 1)
            : (incoming.fromMe ? 0 : 1)
        };
        return [updated, ...current.filter((chat) => chat.chatId !== incoming.chatId)];
      });
      if (incoming.chatId === selectedChatIdRef.current) {
        historyRevision.current += 1;
        setHistory((current) => current.some((message) => message.id === incoming.id) ? current
          : [...current, messageWithMediaState].sort(compareHistoryMessages));
      }
    };

    const updateChatPreview = (message: IncomingMessage) => {
      chatsRevision.invalidate();
      setChats((current) => current.map((chat) => chat.chatId === message.chatId && message.timestamp >= chat.timestamp
        ? { ...chat, chatName: message.chatName, lastMessage: message.body, timestamp: message.timestamp }
        : chat));
    };

    let lastStatus: BridgeStatus = "unknown";
    setSocketState("connecting");
    setHttpState("connecting");
    const connection: ProviderConnection = subscribe((event: BridgeEvent) => {
      if (event.type === "status") {
        if (typeof event.sessionId === "string" && event.sessionId) {
          adoptBridgeSession(event.sessionId);
          setBridgeSessionId(event.sessionId);
        }
        updateStatus(event.status);
        if (event.status === "ready" && lastStatus !== "ready") {
          void loadChats();
          if (selectedChatIdRef.current) setHistoryRefresh((current) => current + 1);
        }
        lastStatus = event.status;
      }
      if (event.type === "message") {
        addMessage(event.message);
        if (event.message.chatId === selectedChatIdRef.current && event.message.mediaKind) {
          setHistoryRefresh((current) => current + 1);
        }
      }
      if (event.type === "message_update") {
        updateChatPreview(event.message);
        if (event.message.chatId === selectedChatIdRef.current) historyRevision.current += 1;
        recentLiveMessages.current.update(event.message.id, (recentLiveMessage) =>
          event.update === "deleted"
            ? { ...recentLiveMessage, ...event.message, reaction: undefined, reactions: undefined }
            : { ...recentLiveMessage, body: event.message.body });
        setHistory((current) => current.map((existing) => existing.id !== event.message.id ? existing
          : event.update === "deleted" ? { ...existing, ...event.message, reaction: undefined, reactions: undefined }
          : { ...existing, body: event.message.body }));
      }
      if (event.type === "message_ack") {
        recentLiveMessages.current.update(event.messageId, (existing) => ({ ...existing, ack: event.ack }));
        setHistory((current) => current.map((existing) => existing.id === event.messageId ? { ...existing, ack: event.ack } : existing));
      }
      if (event.type === "reaction") {
        recentLiveMessages.current.update(event.messageId, (existing) => {
          const ownReaction = event.fromMe ? (event.emoji || undefined) : existing.reaction;
          const reactions = (existing.reactions || []).filter((reaction) => !event.fromMe || reaction !== existing.reaction);
          if (event.emoji) reactions.push(event.emoji);
          return { ...existing, reaction: ownReaction, reactions: uniqueReactions(reactions) };
        });
        setHistory((current) => current.map((existing) => {
          if (existing.id !== event.messageId) return existing;
          const ownReaction = event.fromMe ? (event.emoji || undefined) : existing.reaction;
          const reactions = (existing.reactions || []).filter((reaction) => !event.fromMe || reaction !== existing.reaction);
          if (event.emoji) reactions.push(event.emoji);
          return { ...existing, reaction: ownReaction, reactions: uniqueReactions(reactions) };
        }));
        if (event.fromMe) setOwnReactions((current) => ({ ...current, [event.messageId]: event.emoji || null }));
      }
    }, () => {
      bridgeSessionEstablished.current = false;
      setSocketState("connected");
      bridgeHealthFailures.current = 0;
      void refreshBridgeStatus();
      // Reconcile contacts after every reconnect in case events were missed while offline.
      void loadChats();
    }, () => {
      setSocketState("disconnected");
      reportConnectionWarning("WebSocket disconnected. Reconnecting…");
    }, () => {
      bridgeSessionEstablished.current = false;
      setSocketState("disconnected");
      lastStatus = "unknown";
      reportConnectionWarning("WebSocket disconnected. Reconnecting…");
    });

    const polling = window.setInterval(() => {
      void refreshBridgeStatus();
      // WebSocket events are the primary synchronization path. Refresh the
      // full chat list when disconnected; reconnects refresh it in onOpen.
      if (!connection.connected) void loadChats();
    }, 60000);
    void refreshBridgeStatus();
    void loadChats();
    return () => {
      cancelled = true;
      window.clearInterval(polling);
      controller.abort();
      connection.close();
    };
  }, [enabled, connectionRefresh]);

  return {
    status, socketState, httpState, statusUpdatedAt, lastHealthCheckAt, bridgeSessionId,
    requestReconnect
  };
}
