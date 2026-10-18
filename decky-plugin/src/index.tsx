// Decky panel for WhatsApp conversations, notifications, preferences, and local voice typing.
import { definePlugin, toaster } from "@decky/api";
import { ButtonItem, Focusable, PanelSection, PanelSectionRow, Router, TextField } from "@decky/ui";
import { FaArrowLeft, FaClock, FaCog, FaFilter, FaMicrophone, FaPaperPlane, FaReply, FaSortAlphaDown, FaStop, FaUsers, FaWhatsapp } from "react-icons/fa";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createQueuedRequest, createRevisionGuard } from "./sync-helpers";
import { provider } from "./provider-selected";
import type { BridgeEvent, BridgeStatus } from "./provider";
import { createMockProviderLifecycle } from "./mock-provider-lifecycle";
import { createPluginConnectionSession, getConnectionHeadline, getConnectionToggleLabel, getConnectionWarning, runResumeRecovery } from "./connection-state";
import { formatChatTimestamp } from "./format";
import { compareHistoryMessages, getHistoryExpansionFocusId, getNextHistoryLimit, HistoryRequestLifecycle, INITIAL_COMPACT_HISTORY_LIMIT, mergeHistorySnapshot, RecentLiveMessageCache } from "./history";
import { getMessageStatus } from "./message-status";
import { createNotificationIdCache } from "./notification-id-cache";
import { prepareSteamListenerNamespace, registerControllerInputMessages } from "./steam-compat";
import { attachResumeRegistration } from "./plugin-lifecycle";
import { ContactAvatar } from "./components/ContactAvatar";
import { MessageBubble } from "./components/MessageBubble";
import { createMessageYPressHandler, getMessageYAction } from "./message-actions";
import { getViewOnceNotice } from "./view-once";
import type { ChatSummary } from "./types/chat";
import type { IncomingMessage } from "./types/message";

type SocketState = "connected" | "connecting" | "disconnected" | "disabled" | "unknown";
type ContactsState = "idle" | "loading" | "loaded" | "failed";

type ReplyTarget = {
  id: string;
  sender: string;
  body: string;
};

let reconnectMountedPanel: (() => void) | undefined;
const pluginConnectionSession = createPluginConnectionSession();
// ControllerInputGamepadButton.GAMEPAD_BUTTON_Y in the installed @decky/ui declaration.
const steamControllerYButton = 3;
type ContactMode = "alphabetical" | "recent" | "last5" | "sinceSession";

const reactionChoices = ["❤️", "👍", "😂", "😮", "😢", "🙏"] as const;

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

function inputValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const event = value as { target?: { value?: unknown } };
    if (typeof event.target?.value === "string") return event.target.value;
  }
  return "";
}

function uniqueReactions(reactions: string[] | undefined): string[] | undefined {
  const seen = new Set<string>();
  const unique = (reactions || []).filter((reaction) => {
    if (!reaction) return false;
    const key = reaction.normalize("NFC").replace(/\uFE0F/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length > 0 ? unique : undefined;
}

function compareRecentChats(left: ChatSummary, right: ChatSummary): number {
  return right.timestamp - left.timestamp || left.chatId.localeCompare(right.chatId);
}

function formatDiagnosticTime(value?: number): string {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Never";
}

function hasMediaFallbackBody(body: string): boolean {
  return ["[Image]", "[Sticker]", "[GIF]", "[Voice message]"].includes(body.trim());
}

function mediaFallbackLabel(body: string): string | undefined {
  const labels: Record<string, string> = {
    "[Image]": "Image",
    "[Sticker]": "Sticker",
    "[GIF]": "GIF",
    "[Voice message]": "Voice message"
  };
  return labels[body.trim()];
}

function isTextEntryFocused(ownerDocument: Document = document): boolean {
  const activeElement = ownerDocument.activeElement;
  return Boolean(activeElement && (
    activeElement.matches("input, textarea, select") ||
    (activeElement as HTMLElement).isContentEditable
  ));
}

let backgroundNotifications: ReturnType<typeof provider.subscribe> | undefined;
const mockProviderLifecycle = provider.variant === "mock" ? createMockProviderLifecycle(provider) : undefined;
function subscribeProvider(onEvent: Parameters<typeof provider.subscribe>[0], onOpen: Parameters<typeof provider.subscribe>[1], onError: Parameters<typeof provider.subscribe>[2], onClose: Parameters<typeof provider.subscribe>[3]) {
  return mockProviderLifecycle?.subscribe(onEvent, onOpen, onError, onClose)
    ?? provider.subscribe(onEvent, onOpen, onError, onClose);
}
// Keep recent IDs across socket reconnects; cap this module-lifetime cache at 500.
const recentNotifiedMessageIds = createNotificationIdCache(500);

function stopBackgroundNotifications(): void {
  backgroundNotifications?.close();
  backgroundNotifications = undefined;
}

function startBackgroundNotifications(): void {
  if (
    provider.storageGet("enabled") !== "true" ||
    provider.storageGet("notifications-enabled") === "false"
  ) return;

  if (backgroundNotifications) return;
  backgroundNotifications = subscribeProvider((event) => {
    if (event.type !== "message" || event.message.fromMe) return;
    const messageId = event.message.id;
    if (!messageId || recentNotifiedMessageIds.has(messageId)) return;
    if (provider.storageGet("notifications-while-gaming") === "false" && Router.MainRunningApp) return;
    const showPreview = provider.storageGet("notification-previews") !== "false";
    toaster.toast({
      title: showPreview ? `${provider.label}: ${event.message.chatName}` : "New message",
      body: showPreview ? (event.message.body || "New message") : "New message",
      duration: 5000,
      playSound: provider.storageGet("notification-sound") !== "false",
      showNewIndicator: true
    });
    recentNotifiedMessageIds.remember(messageId);
  }, () => {}, () => console.warn("[decky-whatsapp] notification connection failed"), () => {});
}

type VoiceSession = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  sampleRate: number;
};

function encodeWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

// Panel state, saved preferences, and synchronization effects.
function WhatsAppPanel() {
  // A Decky/plugin restart always requires an explicit user start.
  const [enabled, setEnabled] = useState(() => pluginConnectionSession.isEnabled());
  const [status, setStatus] = useState<BridgeStatus>("unknown");
  const [socketState, setSocketState] = useState<SocketState>("unknown");
  const [httpState, setHttpState] = useState<SocketState>("unknown");
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<number>();
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<number>();
  const [bridgeSessionId, setBridgeSessionId] = useState("");
  const [lastError, setLastError] = useState("");
  const [contactsState, setContactsState] = useState<ContactsState>("idle");
  const [connectionRefresh, setConnectionRefresh] = useState(0);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatSummary | undefined>();
  const [selectedChatId, setSelectedChatId] = useState("");
  const selectedChatIdRef = useRef("");
  const pendingContactFocusId = useRef("");
  const [history, setHistory] = useState<IncomingMessage[]>([]);
  const recentLiveMessages = useRef(new RecentLiveMessageCache());
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [uncertainDeliveryIds, setUncertainDeliveryIds] = useState<Set<string>>(() => new Set());
  const uncertainDeliveryIdsRef = useRef(uncertainDeliveryIds);
  const [ownReactions, setOwnReactions] = useState<Record<string, string | null>>({});
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [focusedMessageId, setFocusedMessageId] = useState("");
  const focusedMessageIdRef = useRef("");
  const messageYAction = useRef<(messageId: string) => boolean>(() => false);
  const messageYPress = useRef<(messageId: string) => boolean>(() => false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const sendInFlight = useRef(false);
  const replyInputActive = useRef(false);
  const [error, setError] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceTypingAvailable, setVoiceTypingAvailable] = useState<boolean | undefined>(undefined);
  const [voiceTypingReason, setVoiceTypingReason] = useState("");
  const [messageActionId, setMessageActionId] = useState("");
  const actionInFlight = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [editingMockMessageId, setEditingMockMessageId] = useState("");
  const [editingMockMessageBody, setEditingMockMessageBody] = useState("");
  const [mockSearchQuery, setMockSearchQuery] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => provider.storageGet("notifications-enabled") !== "false");
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => provider.storageGet("notification-sound") !== "false");
  const [notificationPreviewsEnabled, setNotificationPreviewsEnabled] = useState(() => provider.storageGet("notification-previews") !== "false");
  const [notificationsWhileGaming, setNotificationsWhileGaming] = useState(() => provider.storageGet("notifications-while-gaming") !== "false");
  const [compactHistory, setCompactHistory] = useState(() => provider.storageGet("compact-history") !== "false");
  const [historyLimit, setHistoryLimit] = useState(INITIAL_COMPACT_HISTORY_LIMIT);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyAppliedVersion, setHistoryAppliedVersion] = useState(0);
  const [reactionEmoji, setReactionEmoji] = useState(() => {
    const saved = provider.storageGet("reaction-emoji");
    return reactionChoices.includes(saved as typeof reactionChoices[number]) ? saved as typeof reactionChoices[number] : "❤️";
  });
  const [contactMode, setContactMode] = useState<ContactMode>(() => {
    const saved = provider.storageGet("contact-mode");
    return saved === "alphabetical" || saved === "recent" || saved === "last5" || saved === "sinceSession" ? saved : "recent";
  });
  const voiceSession = useRef<VoiceSession | undefined>(undefined);
  const voiceStarting = useRef(false);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const conversationFocusRef = useRef<HTMLDivElement | null>(null);
  const replyFieldContainerRef = useRef<HTMLDivElement | null>(null);
  const historyExpansionPending = useRef(false);
  const historyExpansionBoundary = useRef<string | undefined>(undefined);
  const historyExpansionFocus = useRef<{ chatId: string; conversationRun: number; messageId: string } | undefined>(undefined);
  const scrollOnOpen = useRef<{ chatId: string; conversationRun: number; baselineVersion: number } | null>(null);
  const historyAppliedConversationRun = useRef<number | undefined>(undefined);
  const profilePicCache = useRef<Record<string, string | null>>({});
  const bridgeHealthFailures = useRef(0);
  const bridgeSessionEstablished = useRef(false);
  const historyRequest = useRef<AbortController | undefined>(undefined);
  const historyRequestLifecycle = useRef(new HistoryRequestLifecycle());
  const panelMounted = useRef(true);
  const conversationRun = useRef(0);
  const historyRevision = useRef(0);

  selectedChatIdRef.current = selectedChatId;
  focusedMessageIdRef.current = focusedMessageId;

  const stopRecording = () => {
    const session = voiceSession.current;
    voiceSession.current = undefined;
    if (session) {
      session.processor.disconnect();
      session.source.disconnect();
      session.stream.getTracks().forEach((track) => track.stop());
      void session.context.close().catch(() => undefined);
    }
    return session;
  };

  useEffect(() => {
    panelMounted.current = true;
    return () => {
      panelMounted.current = false;
      conversationRun.current += 1;
      historyRequest.current?.abort();
      stopRecording();
    };
  }, []);

  useEffect(() => {
    if (!replyTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const field = replyFieldContainerRef.current?.querySelector<HTMLElement>("input, textarea, [contenteditable=\"true\"]");
      if (!field) return;
      field.focus({ preventScroll: true });
      field.click();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [replyTarget]);


  // The plugin-level Steam suspend callback invokes this only while enabled.
  useEffect(() => {
    if (!enabled) {
      reconnectMountedPanel = undefined;
      return;
    }
    const reconnect = () => {
      bridgeHealthFailures.current = 0;
      setSocketState("connecting");
      setHttpState("connecting");
      setConnectionRefresh((current) => current + 1);
    };
    reconnectMountedPanel = reconnect;
    return () => {
      if (reconnectMountedPanel === reconnect) reconnectMountedPanel = undefined;
    };
  }, [enabled]);

  const updateStatus = (nextStatus: BridgeStatus) => {
    setStatus(nextStatus);
    setStatusUpdatedAt(Date.now());
  };

  const adoptBridgeSession = (sessionId: string) => {
    const previousSessionId = recentLiveMessages.current.sessionId;
    const sessionChanged = recentLiveMessages.current.setSession(sessionId);
    const wasEstablished = bridgeSessionEstablished.current;
    bridgeSessionEstablished.current = true;
    if (!sessionChanged && wasEstablished) {
      setBridgeSessionId(sessionId);
      return;
    }
    historyRequestLifecycle.current.invalidate();
    historyRevision.current += 1;
    historyRequest.current?.abort();
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
    setBridgeSessionId(sessionId);
  };

  const reportError = (message: string) => {
    setError(message);
    setLastError(message);
  };

  const reportConnectionWarning = (message: string) => {
    setLastError(message);
  };

  const activeConnectionWarning = getConnectionWarning(enabled, httpState, socketState, status);

  const resetMockScenario = () => {
    if (provider.variant !== "mock") return;
    disconnectLocally();
    historyRequestLifecycle.current.invalidate();
    historyRevision.current += 1;
    historyRequest.current?.abort();
    recentLiveMessages.current.reset();
    mockProviderLifecycle?.reset();
    setOwnReactions({});
    setUncertainDeliveryIds(new Set());
    uncertainDeliveryIdsRef.current = new Set();
    setEditingMockMessageId("");
    setEditingMockMessageBody("");
    setSelectedMessageId("");
    setFocusedMessageId("");
    setReplyTarget(undefined);
    setReply("");
    setMessageActionId("");
    setChats([]);
    setHistory([]);
    setContactsState("idle");
    setMockSearchQuery("");
    setError("");
    setLastError("");
  };

  useEffect(() => {
    provider.storageSet("contact-mode", contactMode);
  }, [contactMode]);

  useEffect(() => {
    provider.storageSet("compact-history", String(compactHistory));
  }, [compactHistory]);

  useEffect(() => {
    provider.storageSet("reaction-emoji", reactionEmoji);
  }, [reactionEmoji]);

  useEffect(() => {
    provider.storageSet("notifications-enabled", String(notificationsEnabled));
    if (notificationsEnabled && enabled) startBackgroundNotifications();
    else stopBackgroundNotifications();
  }, [notificationsEnabled, enabled]);

  useEffect(() => {
    provider.storageSet("notification-sound", String(notificationSoundEnabled));
  }, [notificationSoundEnabled]);

  useEffect(() => {
    provider.storageSet("notification-previews", String(notificationPreviewsEnabled));
  }, [notificationPreviewsEnabled]);

  useEffect(() => {
    provider.storageSet("notifications-while-gaming", String(notificationsWhileGaming));
  }, [notificationsWhileGaming]);

  useEffect(() => {
    let cancelled = false;
    void provider.voiceStatus()
      .then((result) => {
        if (cancelled) return;
        setVoiceTypingAvailable(result.available);
        setVoiceTypingReason(result.reason === "not_configured"
          ? "Install the optional Deck-local Whisper engine first"
          : result.reason ? "Voice typing is unavailable" : "");
      })
      .catch(() => {
        // Older installations may not have the optional status method yet.
        // Keep the control usable and let transcription report its result.
        if (!cancelled) setVoiceTypingAvailable(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleChats = useMemo(() => {
    const matchingIds = provider.variant === "mock"
      ? new Set(provider.searchContacts(mockSearchQuery).map((chat) => chat.chatId))
      : undefined;
    const ordered = chats.filter((chat) => !matchingIds || matchingIds.has(chat.chatId)).sort((left, right) => {
      if (contactMode === "alphabetical") return left.chatName.localeCompare(right.chatName);
      return compareRecentChats(left, right);
    });
    if (contactMode === "last5") return ordered.slice(0, 5);
    if (contactMode === "sinceSession") return ordered.filter((chat) => chat.receivedSinceSession);
    return ordered;
  }, [chats, contactMode, mockSearchQuery]);

  // Avatar updates must not cancel and restart all four workers.
  const profileChatIds = JSON.stringify(visibleChats.map((chat) => chat.chatId).sort());

  useEffect(() => {
    if (!enabled || status !== "ready" || selectedChatId || showSettings || showDiagnostics) return;
    let cancelled = false;
    const controller = new AbortController();
    const profileQueue = JSON.parse(profileChatIds) as string[];
    setChats((current) => current.map((chat) => profilePicCache.current[chat.chatId]
      ? { ...chat, profilePicUrl: profilePicCache.current[chat.chatId]! } : chat));
    const loadProfiles = async () => {
      while (!cancelled) {
        const chatId = profileQueue.shift();
        if (!chatId) return;
        if (Object.prototype.hasOwnProperty.call(profilePicCache.current, chatId)) continue;
        try {
          const profileResponse = await provider.request("profile", { chatId }, controller.signal);
          if (!profileResponse.ok) {
            continue;
          }
          const profile = await profileResponse.json() as { profilePicUrl?: string | null };
          profilePicCache.current[chatId] = profile.profilePicUrl || null;
          if (cancelled || !profile.profilePicUrl) continue;
          setChats((current) => current.map((item) => item.chatId === chatId ? { ...item, profilePicUrl: profile.profilePicUrl || undefined } : item));
        } catch {
          // Profile pictures are optional and must not affect synchronization.
        }
      }
    };
    void Promise.all(Array.from({ length: 4 }, () => loadProfiles()));
    return () => {
      cancelled = true;
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
      setSelectedChat(undefined);
      setSelectedChatId("");
      setHistory([]);
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
      } catch (loadError) {
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
          if (typeof health.sessionId === "string" && health.sessionId) adoptBridgeSession(health.sessionId);
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
          unreadCount: existing ? existing.unreadCount + (incoming.fromMe || incoming.chatId === selectedChatIdRef.current ? 0 : 1) : (incoming.fromMe ? 0 : 1)
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
    const connection = subscribeProvider((message) => {
          if (message.type === "status") {
            if (typeof message.sessionId === "string" && message.sessionId) adoptBridgeSession(message.sessionId);
            updateStatus(message.status);
            if (message.status === "ready" && lastStatus !== "ready") {
              void loadChats();
              if (selectedChatIdRef.current) setHistoryRefresh((current) => current + 1);
            }
            lastStatus = message.status;
          }
          if (message.type === "message") {
            addMessage(message.message);
            if (message.message.chatId === selectedChatIdRef.current && message.message.mediaKind) setHistoryRefresh((current) => current + 1);
          }
          if (message.type === "message_update") {
            updateChatPreview(message.message);
            if (message.message.chatId === selectedChatIdRef.current) historyRevision.current += 1;
            recentLiveMessages.current.update(message.message.id, (recentLiveMessage) =>
              message.update === "deleted"
                ? { ...recentLiveMessage, ...message.message, reaction: undefined, reactions: undefined }
                : { ...recentLiveMessage, body: message.message.body });
            setHistory((current) => current.map((existing) => existing.id !== message.message.id ? existing
              : message.update === "deleted" ? { ...existing, ...message.message, reaction: undefined, reactions: undefined }
              : { ...existing, body: message.message.body }));
          }
          if (message.type === "message_ack") {
            recentLiveMessages.current.update(message.messageId, (existing) => ({ ...existing, ack: message.ack }));
            setHistory((current) => current.map((existing) => existing.id === message.messageId ? { ...existing, ack: message.ack } : existing));
          }
          if (message.type === "reaction") {
            recentLiveMessages.current.update(message.messageId, (existing) => {
              const ownReaction = message.fromMe ? (message.emoji || undefined) : existing.reaction;
              const reactions = (existing.reactions || []).filter((reaction) => !message.fromMe || reaction !== existing.reaction);
              if (message.emoji) reactions.push(message.emoji);
              return { ...existing, reaction: ownReaction, reactions: uniqueReactions(reactions) };
            });
            setHistory((current) => current.map((existing) => {
              if (existing.id !== message.messageId) return existing;
              const ownReaction = message.fromMe ? (message.emoji || undefined) : existing.reaction;
              const reactions = (existing.reactions || []).filter((reaction) => !message.fromMe || reaction !== existing.reaction);
              if (message.emoji) reactions.push(message.emoji);
              return { ...existing, reaction: ownReaction, reactions: uniqueReactions(reactions) };
            }));
            if (message.fromMe) setOwnReactions((current) => ({ ...current, [message.messageId]: message.emoji || null }));
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

  useEffect(() => {
    if (!selectedChatId || !enabled || historyRefresh === 0) return;
    // Coalesce bursts of media/status events into one history request.
    const timer = window.setTimeout(() => {
      void loadHistory(selectedChatId).catch(() => {
        setHistory((current) => current.map((message) => message.mediaLoadState === "loading"
          ? { ...message, mediaLoadState: "unavailable" }
          : message));
        if (historyExpansionPending.current) {
          historyExpansionPending.current = false;
          historyExpansionBoundary.current = undefined;
          historyExpansionFocus.current = undefined;
          setHistoryLoading(false);
          reportError("Older messages could not be loaded");
        }
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [historyRefresh]);

  useEffect(() => {
    const pendingOpen = scrollOnOpen.current;
    if (
      !selectedChatId || historyLoading || !pendingOpen ||
      pendingOpen.chatId !== selectedChatId || pendingOpen.conversationRun !== conversationRun.current ||
      historyAppliedVersion <= pendingOpen.baselineVersion ||
      historyAppliedConversationRun.current !== pendingOpen.conversationRun
    ) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (
        cancelled || scrollOnOpen.current !== pendingOpen ||
        selectedChatIdRef.current !== pendingOpen.chatId || conversationRun.current !== pendingOpen.conversationRun
      ) return;
      const newestMessage = history[history.length - 1];
      const conversationElement = conversationFocusRef.current;
      const messageElement = newestMessage && conversationElement
        ? Array.from(conversationElement.querySelectorAll<HTMLElement>("[data-decky-message-id]"))
          .find((element) => element.dataset.deckyMessageId === newestMessage.id)
        : undefined;
      // Do not consume a non-empty open until its matching message exists in this render target.
      if (newestMessage && !messageElement) return;
      // A successful empty history or a rendered message completes this open exactly once.
      scrollOnOpen.current = null;
      if (!newestMessage || !messageElement) return;
      const ownerDocument = messageElement.ownerDocument;
      if (replyInputActive.current || isTextEntryFocused(ownerDocument)) return;
      const ownerWindow = ownerDocument.defaultView;
      if (!ownerWindow) return;
      const messageFocusTarget = messageElement.querySelector<HTMLElement>('button, [role="button"], [tabindex="0"]');
      if (messageFocusTarget) {
        messageFocusTarget.focus({ preventScroll: true });
        setFocusedMessageId(newestMessage.id);
      }
      let scrollContainer = messageElement.parentElement;
      while (scrollContainer && scrollContainer !== ownerDocument.body) {
        const overflowY = ownerWindow.getComputedStyle(scrollContainer).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && scrollContainer.scrollHeight > scrollContainer.clientHeight) break;
        scrollContainer = scrollContainer.parentElement;
      }
      const deckyScrollContainer = scrollContainer && scrollContainer !== ownerDocument.body
        ? scrollContainer
        : ownerDocument.scrollingElement as HTMLElement | null;
      if (deckyScrollContainer) deckyScrollContainer.scrollTop = deckyScrollContainer.scrollHeight;
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [selectedChatId, historyLoading, history.length, historyAppliedVersion]);

  useEffect(() => {
    // Restore position only after expanded history applies; discarded requests leave the anchor pending.
    const pendingFocus = historyExpansionFocus.current;
    if (!pendingFocus || historyLoading || historyExpansionPending.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (historyExpansionFocus.current !== pendingFocus
        || selectedChatIdRef.current !== pendingFocus.chatId
        || conversationRun.current !== pendingFocus.conversationRun) return;
      const conversation = conversationFocusRef.current;
      const messageElement = conversation && Array.from(conversation.querySelectorAll<HTMLElement>("[data-decky-message-id]"))
        .find((element) => element.dataset.deckyMessageId === pendingFocus.messageId);
      historyExpansionFocus.current = undefined;
      if (!messageElement || replyInputActive.current || isTextEntryFocused(messageElement.ownerDocument)) return;

      const focusTarget = messageElement.querySelector<HTMLElement>('button, [role="button"], [tabindex="0"]');
      focusTarget?.focus({ preventScroll: true });
      setFocusedMessageId(pendingFocus.messageId);

      const ownerDocument = messageElement.ownerDocument;
      const ownerWindow = ownerDocument.defaultView;
      if (!ownerWindow) return;
      let scrollContainer = messageElement.parentElement;
      while (scrollContainer && scrollContainer !== ownerDocument.body) {
        const overflowY = ownerWindow.getComputedStyle(scrollContainer).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && scrollContainer.scrollHeight > scrollContainer.clientHeight) break;
        scrollContainer = scrollContainer.parentElement;
      }
      const viewport = scrollContainer && scrollContainer !== ownerDocument.body
        ? scrollContainer
        : ownerDocument.scrollingElement as HTMLElement | null;
      if (viewport) {
        const messageRect = messageElement.getBoundingClientRect();
        const viewportRect = viewport === ownerDocument.scrollingElement
          ? { top: 0, height: ownerWindow.innerHeight }
          : viewport.getBoundingClientRect();
        viewport.scrollTop += messageRect.top - viewportRect.top - (viewportRect.height - messageRect.height) / 2;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historyLoading, history.length, historyAppliedVersion]);

  useEffect(() => {
    // Decky's controller button values: X=2 and Y=3. Leave navigation and back
    // handling to SteamOS so the plugin does not replace system controls.
    return registerControllerInputMessages((_controllerIndex, gamepadButton, isButtonPressed) => {
      if (isTextEntryFocused() || replyInputActive.current) return;
      if (isButtonPressed && gamepadButton === 2) {
        const focusedMessage = history.find((message) => message.id === focusedMessageId) || history.find((message) => message.id === selectedMessageId);
        if (focusedMessage) {
          const trackedReaction = Object.prototype.hasOwnProperty.call(ownReactions, focusedMessage.id)
            ? ownReactions[focusedMessage.id]
            : (focusedMessage.reaction || ((focusedMessage.reactions || []).includes(reactionEmoji) ? reactionEmoji : undefined));
          const nextReaction = trackedReaction === reactionEmoji ? "" : reactionEmoji;
          void reactToMessage(focusedMessage.chatId, focusedMessage.id, nextReaction);
        }
        return;
      }
      // Y is routed by the single handler below so audio toggles exactly once.
    }, provider.variant);
  }, [history, focusedMessageId, selectedMessageId, selectedChatId, reactionEmoji, ownReactions]);

  useEffect(() => {
    if (selectedChatId || !pendingContactFocusId.current) return;
    const chatId = pendingContactFocusId.current;
    pendingContactFocusId.current = "";
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-decky-chat-id="${CSS.escape(chatId)}"]`);
      const focusable = row?.querySelector<HTMLElement>('button, [role="button"], [tabindex="0"]');
      focusable?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedChatId, showSettings, showDiagnostics]);

  const connectPlugin = () => {
    pluginConnectionSession.setEnabled(true);
    provider.storageSet("enabled", "true");
    setEnabled(true);
    setError("");
  };

  const disconnectLocally = () => {
    pluginConnectionSession.setEnabled(false);
    provider.storageSet("enabled", "false");
    setEnabled(false);
    stopBackgroundNotifications();
    closeConversation();
    setError("");
  };

  const reconnectFromDiagnostics = () => {
    bridgeHealthFailures.current = 0;
    setSocketState("connecting");
    setHttpState("connecting");
    setConnectionRefresh((current) => current + 1);
  };

  // Conversation history, message actions, and navigation.
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
        deliveryUncertain: message.deliveryUncertain || uncertainDeliveryIdsRef.current.has(message.id),
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
      // Only mark the conversation read after it is open and its history request
      // completed. Retry transient failures without delaying conversation display.
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
      // Expansion may replace an aborted media refresh, so settle its placeholders if expansion fails.
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

  // Reuse the cancellable history refresh and its stale-response checks for media retries.
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
      } catch (sendError) {
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
    if (!selectedChatId || !message.fromMe || message.ack !== -1 || message.deliveryUncertain || uncertainDeliveryIdsRef.current.has(message.id) || actionInFlight.current) return;
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
        const uncertainIds = new Set(uncertainDeliveryIdsRef.current);
        uncertainIds.add(message.id);
        uncertainDeliveryIdsRef.current = uncertainIds;
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
    try {
      const response = await provider.request("react", { chatId, messageId, emoji });
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(details?.error || `reaction failed (${response.status})`);
      }
      if (selectedChatId) await loadHistory(selectedChatId, compactHistory ? historyLimit : 50);
      setOwnReactions((current) => ({ ...current, [messageId]: emoji || null }));
      setHistory((current) => current.map((message) => {
        if (message.id !== messageId) return message;
        const otherReactions = (message.reactions || []).filter((reaction) => reaction !== reactionEmoji && reaction !== emoji);
        const reactions = emoji ? [...otherReactions, emoji] : otherReactions;
        return { ...message, reaction: emoji || undefined, reactions: uniqueReactions(reactions) };
      }));
    } catch {
      console.error("[decky-whatsapp] reaction failed");
      reportError("Reaction could not be sent");
    }
  };

  const closeConversation = () => {
    pendingContactFocusId.current = selectedChatIdRef.current;
    historyExpansionPending.current = false;
    historyExpansionBoundary.current = undefined;
    historyExpansionFocus.current = undefined;
    replyInputActive.current = false;
    conversationRun.current += 1;
    scrollOnOpen.current = null;
    selectedChatIdRef.current = "";
    historyRequest.current?.abort();
    stopRecording();
    setVoiceState("idle");
    setSelectedChat(undefined);
    setSelectedChatId("");
    setHistory([]);
    setHistoryLimit(INITIAL_COMPACT_HISTORY_LIMIT);
    setHistoryHasMore(false);
    setFocusedMessageId("");
    setSelectedMessageId("");
    setReply("");
    setReplyTarget(undefined);
    setError("");
  };

  const startVoiceTyping = async () => {
    if (voiceState === "transcribing" || voiceStarting.current) return;
    const run = conversationRun.current;
    const stillActive = () => panelMounted.current && conversationRun.current === run;
    if (voiceTypingAvailable === false) {
      toaster.toast({ title: "Voice typing unavailable", body: voiceTypingReason || "Install the optional Deck-local Whisper engine first", duration: 6000 });
      return;
    }
    if (voiceState === "recording") {
      const session = stopRecording();
      if (!session) return;
      setVoiceState("transcribing");
      setError("Transcribing…");
      try {
        const wav = encodeWav(session.chunks, session.sampleRate);
        if (session.chunks.length === 0) throw new Error("No audio was captured from the microphone");
        const transcript = await provider.transcribe(arrayBufferToBase64(wav));
        if (!stillActive()) return;
        if (transcript.startsWith("__VOICE_ERROR__")) {
          const category = transcript.slice("__VOICE_ERROR__".length);
          if (category === "not_configured") {
            setVoiceTypingAvailable(false);
            setVoiceTypingReason("Install the optional Deck-local Whisper engine first");
          }
          const messages: Record<string, string> = {
            invalid_recording: "The recording could not be processed",
            not_configured: "Voice typing is not configured",
            no_speech: "No speech was detected. Try speaking closer to the microphone",
            transcription_failed: "Transcription failed. Check the Whisper installation and try again"
          };
          throw new Error(messages[category] || "Transcription failed");
        }
        if (!transcript?.trim()) throw new Error("Whisper returned no text");
        setReply((current) => current ? `${current} ${transcript.trim()}` : transcript.trim());
        setError("");
        toaster.toast({ title: "Voice typing", body: "Text added to your reply", duration: 3000 });
      } catch (voiceError) {
        if (!stillActive()) return;
        const message = voiceError instanceof Error && voiceError.message === "No audio was captured from the microphone"
          ? voiceError.message
          : "Transcription failed. Please try again";
        reportError(message);
        toaster.toast({ title: "Voice typing failed", body: message, duration: 6000 });
      } finally {
        if (stillActive()) setVoiceState("idle");
      }
      return;
    }

    voiceStarting.current = true;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!stillActive()) { stream.getTracks().forEach((track) => track.stop()); return; }
      context = new AudioContext();
      await context.resume();
      if (!stillActive()) { stream.getTracks().forEach((track) => track.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentOutput = context.createGain();
      const chunks: Float32Array[] = [];
      silentOutput.gain.value = 0;
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(context.destination);
      voiceSession.current = { context, stream, source, processor, chunks, sampleRate: context.sampleRate };
      setVoiceState("recording");
      toaster.toast({ title: "Voice typing", body: "Recording… press the microphone again to stop", duration: 3000 });
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      if (stillActive()) reportError("Microphone access failed");
    } finally {
      voiceStarting.current = false;
    }
  };

  const renderMedia = (message: IncomingMessage) => {
    const viewOnceNotice = getViewOnceNotice(message.viewOnce);
    if (viewOnceNotice) {
      return <div role="status" style={{ marginTop: "8px", padding: "8px 10px", borderRadius: "8px", background: "rgba(255,255,255,0.08)", fontSize: "12px", lineHeight: 1.35 }}>{viewOnceNotice}</div>;
    }
    const knownMediaLabel = message.mediaKind === "audio" ? "Voice message"
      : message.mediaKind === "gif" ? "GIF"
        : message.mediaKind === "sticker" ? "Sticker"
          : message.mediaKind === "image" ? "Image"
            : mediaFallbackLabel(message.body);
    if (message.mediaLoadState === "unavailable") {
      const label = knownMediaLabel || "Media";
      const audioLayout = message.mediaKind === "audio" || label === "Voice message";
      return <div role="status" style={{ marginTop: "8px", minHeight: audioLayout ? "112px" : "180px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "6px", opacity: 0.7, fontSize: "12px" }}>
        <span>{label} unavailable</span>
        <button type="button" onClick={(event) => { event.stopPropagation(); retryMediaLoad(message.id); }} style={{ padding: "4px 8px", borderRadius: "6px", border: "0", color: "white", background: "rgba(255,255,255,0.12)" }}>Retry media</button>
      </div>;
    }
    if (!message.media && !message.image) {
      if (message.mediaLoadState === "loading" || message.mediaKind) {
        const mediaLabel = knownMediaLabel || "Media";
        const audioLayout = mediaLabel === "Voice message";
        return <div role="status" style={{ marginTop: "8px", minHeight: audioLayout ? "112px" : "180px", display: "flex", justifyContent: "center", alignItems: "center", opacity: 0.65, fontSize: "12px" }}>Loading {mediaLabel.toLowerCase()}…</div>;
      }
      if (knownMediaLabel) return <div role="status" style={{ marginTop: "8px", minHeight: knownMediaLabel === "Voice message" ? "112px" : "180px", display: "flex", justifyContent: "center", alignItems: "center", opacity: 0.65, fontSize: "12px" }}>{knownMediaLabel} unavailable</div>;
      return null;
    }
    const media = message.media || { ...message.image!, kind: "image" as const, mimetype: "image/jpeg" };
    // Reserved media slots keep later image/GIF decoding from shifting the reading position.
    if (media.kind === "audio" || media.mimetype.startsWith("audio/")) {
      const playAudio = () => {
        const audio = audioRefs.current[message.id];
        if (!audio) return;
        void audio.play().catch(() => {
          console.error("[decky-whatsapp] voice playback failed");
          toaster.toast({ title: "Voice message", body: "Decky could not play this audio", duration: 5000 });
        });
      };
      return <div style={{ marginTop: "8px", minHeight: "112px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>Voice message · select it and press Y</div><audio ref={(element) => { audioRefs.current[message.id] = element; }} src={media.dataUrl} aria-label="WhatsApp voice message" preload="auto" controls onError={() => { markMediaUnavailable(message.id); console.error("[decky-whatsapp] voice media element error"); }} style={{ width: "100%" }} /><button type="button" onClick={(event) => { event.stopPropagation(); playAudio(); }} style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", border: "0", color: "white", background: "rgba(99, 210, 173, 0.35)" }}>▶ Play voice message</button></div>;
    }
    if (media.kind === "gif" || media.mimetype.startsWith("video/")) {
      return <div style={{ marginTop: "8px", height: "180px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>GIF</div><video src={media.dataUrl} aria-label={media.filename || "WhatsApp GIF"} autoPlay loop muted playsInline controls onError={() => markMediaUnavailable(message.id)} style={{ display: "block", width: "100%", height: "156px", objectFit: "contain", borderRadius: "10px" }} /></div>;
    }
    return <div style={{ marginTop: "8px", height: "180px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>{media.kind === "sticker" ? "Sticker" : "Image"}</div><img src={media.dataUrl} alt={media.filename || (media.kind === "sticker" ? "WhatsApp sticker" : "WhatsApp image")} onError={() => markMediaUnavailable(message.id)} style={{ display: "block", width: "100%", height: "156px", objectFit: "contain", borderRadius: "10px" }} /></div>;
  };

  const getControllerFocusedMessageId = () => {
    const conversation = conversationFocusRef.current;
    const activeElement = conversation?.ownerDocument.activeElement;
    if (conversation && activeElement) {
      for (const element of conversation.querySelectorAll<HTMLElement>("[data-decky-message-id]")) {
        if (element.contains(activeElement)) return element.dataset.deckyMessageId || "";
      }
    }
    // Steam controller focus is not always reflected by document.activeElement.
    // Keep using the last message that received focus instead of dropping Y.
    return focusedMessageIdRef.current;
  };

  const activateMessageY = (messageId: string): boolean => {
    if (!messageId) return false;
    const message = history.find((item) => item.id === messageId);
    const action = getMessageYAction(message);
    if (!message || !action) return false;
    const audio = audioRefs.current[messageId];
    if (!audio) return false;
    if (audio.paused) void audio.play().catch(() => console.error("[decky-whatsapp] voice playback failed"));
    else audio.pause();
    return true;
  };
  messageYAction.current = activateMessageY;
  messageYPress.current = createMessageYPressHandler({
    isTextEntryFocused,
    isReplyInputActive: () => replyInputActive.current,
    activateMessage: (messageId) => messageYAction.current(messageId)
  });

  useEffect(() => {
    if (!enabled || !selectedChatId) return;
    return registerControllerInputMessages((_controllerIndex, button, isButtonPressed) => {
      if (button !== steamControllerYButton) return;
      if (!isButtonPressed) return;
      const messageId = getControllerFocusedMessageId();
      if (messageId) messageYPress.current(messageId);
    }, provider.variant);
  }, [enabled, selectedChatId]);

  const displayedHistory = compactHistory ? history.slice(-historyLimit) : history;
  const nextHistoryLimit = getNextHistoryLimit(historyLimit, historyHasMore);
  const selectedMessage = selectedMessageId ? history.find((message) => message.id === selectedMessageId) : undefined;

  const connectionToggle = <ButtonItem layout="below" onClick={() => enabled ? disconnectLocally() : connectPlugin()}>{getConnectionToggleLabel(enabled)}</ButtonItem>;
  const connectionToggleNode = provider.variant === "mock"
    ? <div data-testid={enabled ? "mock-connection-toggle-stop" : "mock-connection-toggle-start"} style={{ display: "contents" }}>{connectionToggle}</div>
    : connectionToggle;

  const panelContent = (
    <>
        <PanelSection title={provider.label}>
        <PanelSectionRow><div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: 0.8 }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: getConnectionHeadline(enabled, httpState, socketState, status) === "Connected" ? "#63d297" : "#d49b57" }} /> {getConnectionHeadline(enabled, httpState, socketState, status)}</div></PanelSectionRow>
        <PanelSectionRow>{connectionToggleNode}</PanelSectionRow>
        {activeConnectionWarning && <PanelSectionRow><div style={{ color: "#ffbd75", fontSize: "13px" }}>{activeConnectionWarning}</div></PanelSectionRow>}
        {error && <PanelSectionRow><div style={{ color: "#ff8d8d", fontSize: "13px" }}>{error}</div></PanelSectionRow>}
      </PanelSection>
      {!selectedChatId && !showSettings && !showDiagnostics && (
        <PanelSection title={`${provider.variant === "mock" ? "MOCK / OFFLINE · " : ""}Contacts (${visibleChats.length})`}>
          <div data-decky-provider={provider.variant} data-testid="decky-provider-ready" />
          {provider.variant === "mock" && <PanelSectionRow><div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <ButtonItem layout="below" onClick={() => provider.simulateIncoming()}>Simulate incoming message</ButtonItem>
            <ButtonItem layout="below" onClick={() => provider.switchSession()}>Switch mock session</ButtonItem>
            <ButtonItem layout="below" onClick={() => provider.simulateError()}>Make mock bridge unavailable</ButtonItem>
            <ButtonItem layout="below" onClick={() => provider.simulateReconnect()}>Reconnect mock bridge</ButtonItem>
            <ButtonItem layout="below" onClick={() => provider.simulateSendFailure()}>Fail next mock send</ButtonItem>
            <ButtonItem layout="below" onClick={() => provider.simulateMediaFailure()}>Fail next mock image load</ButtonItem>
            <ButtonItem layout="below" onClick={() => provider.simulateDelay(2000)}>Delay next mock response</ButtonItem>
            <ButtonItem layout="below" onClick={resetMockScenario}>Reset mock data</ButtonItem>
          </div></PanelSectionRow>}
          {provider.variant === "mock" && <PanelSectionRow><TextField label="Search mock contacts" value={mockSearchQuery} onChange={(value) => setMockSearchQuery(inputValue(value))} /></PanelSectionRow>}
          {activeConnectionWarning && <PanelSectionRow><div style={{ color: "#ffbd75", fontSize: "13px", padding: "8px 0" }}>{activeConnectionWarning}</div></PanelSectionRow>}
          {status === "qr_required" || status === "auth_failure" ? <PanelSectionRow><div style={{ color: "#ffbd75", padding: "12px 0" }}>WhatsApp needs authentication. Complete QR sign-in on the computer running the bridge.</div></PanelSectionRow>
            : contactsState === "loading" && chats.length === 0 ? <PanelSectionRow><div style={{ opacity: 0.7, padding: "12px 0" }}>Loading conversations…</div></PanelSectionRow>
            : contactsState === "failed" && chats.length === 0 ? <PanelSectionRow><div style={{ padding: "12px 0" }}><div style={{ opacity: 0.8 }}>Could not load conversations.</div><ButtonItem layout="below" onClick={() => setConnectionRefresh((current) => current + 1)}>Retry</ButtonItem></div></PanelSectionRow>
            : status !== "ready" && enabled && chats.length === 0 ? <PanelSectionRow><div style={{ opacity: 0.7, padding: "12px 0" }}>Waiting for WhatsApp to become ready…</div></PanelSectionRow>
            : visibleChats.length === 0 && contactsState === "loaded" ? <PanelSectionRow><div style={{ opacity: 0.7, padding: "12px 0" }}>No conversations match this setting.</div></PanelSectionRow>
            : null}
          {contactsState === "failed" && chats.length > 0 && <PanelSectionRow><div style={{ opacity: 0.75, fontSize: "12px" }}>Showing saved conversations. Refresh failed. <ButtonItem layout="below" onClick={() => setConnectionRefresh((current) => current + 1)}>Retry</ButtonItem></div></PanelSectionRow>}
          {visibleChats.map((chat) => (
            <PanelSectionRow key={chat.chatId}>
              <div data-decky-chat-id={chat.chatId} data-testid={`mock-chat-${chat.chatId}`} data-decky-action={provider.variant === "mock" && chat.chatId === "mock-contact-ava" ? "open-ava" : undefined}>
              <ButtonItem layout="below" onClick={() => void selectChat(chat)}>
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
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setShowSettings(true)}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaCog /> Settings</span></ButtonItem></PanelSectionRow>
        </PanelSection>
      )}
      {!selectedChatId && showSettings && !showDiagnostics && (
        <PanelSection title="Settings">
          <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "4px 0 8px" }}>Choose how your {provider.label} contacts are arranged.</div></PanelSectionRow>
          <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "8px 0 2px" }}>Notifications</div></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setNotificationsEnabled((current) => !current)}><div style={{ textAlign: "left" }}><strong>{notificationsEnabled ? "✓ " : ""}Decky message notifications</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Show or suppress Decky notifications only. This does not disconnect the plugin or stop the PC bridge.</div></div></ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setNotificationSoundEnabled((current) => !current)}><div style={{ textAlign: "left" }}><strong>{notificationSoundEnabled ? "✓ " : ""}Play notification sounds</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Play a sound with new message notifications.</div></div></ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setNotificationPreviewsEnabled((current) => !current)}><div style={{ textAlign: "left" }}><strong>{notificationPreviewsEnabled ? "✓ " : ""}Show message previews</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Include the contact name and message text in notifications.</div></div></ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setNotificationsWhileGaming((current) => !current)}><div style={{ textAlign: "left" }}><strong>{notificationsWhileGaming ? "✓ " : ""}Notify while gaming</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Keep message notifications active after leaving this plugin.</div></div></ButtonItem></PanelSectionRow>
          <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "8px 0 2px" }}>Select default reaction (press x)</div></PanelSectionRow>
          {reactionChoices.map((emoji) => <PanelSectionRow key={emoji}><ButtonItem layout="below" onClick={() => setReactionEmoji(emoji)}><span style={{ fontSize: "22px" }}>{reactionEmoji === emoji ? "✓ " : "  "}{emoji}</span></ButtonItem></PanelSectionRow>)}
          {(Object.keys(contactModeLabels) as ContactMode[]).map((mode) => (
            <PanelSectionRow key={mode}>
              <ButtonItem layout="below" onClick={() => { setContactMode(mode); setShowSettings(false); }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                  {mode === "alphabetical" ? <FaSortAlphaDown /> : mode === "recent" ? <FaClock /> : mode === "last5" ? <FaFilter /> : <FaUsers />}
                  <div style={{ flex: 1 }}><div><strong>{contactMode === mode ? "✓ " : ""}{contactModeLabels[mode]}</strong></div><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>{contactModeDescriptions[mode]}</div></div>
                </div>
              </ButtonItem>
            </PanelSectionRow>
          ))}
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setCompactHistory((current) => !current)}><div style={{ display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}><FaClock /><div><div><strong>{compactHistory ? "✓ " : ""}Show only the last 5 messages</strong></div><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Keep conversations compact and load older messages on demand.</div></div></div></ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setShowDiagnostics(true)}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}>Diagnostics</span></ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setShowSettings(false)}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to contacts</span></ButtonItem></PanelSectionRow>
        </PanelSection>
      )}
      {!selectedChatId && showDiagnostics && (
        <PanelSection title="Diagnostics">
          <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "4px 0 8px" }}>Connection details for troubleshooting Decky WhatsApp.</div></PanelSectionRow>
          <PanelSectionRow><div><strong>Plugin</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{enabled ? "Enabled" : "Disabled"}</div></div></PanelSectionRow>
          <PanelSectionRow><div><strong>Bridge HTTP</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{httpState === "connected" ? "Reachable" : httpState === "connecting" ? "Checking…" : httpState === "disabled" ? "Disabled" : "Unavailable"}</div></div></PanelSectionRow>
          <PanelSectionRow><div><strong>WebSocket tunnel</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{socketState}</div></div></PanelSectionRow>
          <PanelSectionRow><div><strong>{provider.variant === "mock" ? "Mock session" : "WhatsApp Web"}</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{status}</div></div></PanelSectionRow>
          <PanelSectionRow><div><strong>Authentication</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{status === "ready" ? "Authenticated and ready" : status === "authenticated" ? "Authenticated; still starting" : status === "qr_required" ? "QR code required" : status === "auth_failure" ? "Authentication failed" : "Not confirmed"}</div></div></PanelSectionRow>
          <PanelSectionRow><div><strong>Last status update</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{formatDiagnosticTime(statusUpdatedAt)}</div></div></PanelSectionRow>
          <PanelSectionRow><div><strong>Last health check</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{formatDiagnosticTime(lastHealthCheckAt)}</div></div></PanelSectionRow>
          {bridgeSessionId && <PanelSectionRow><div><strong>Bridge session</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px", fontFamily: "monospace" }}>{bridgeSessionId}</div></div></PanelSectionRow>}
          <PanelSectionRow><div><strong>Last error</strong><div style={{ opacity: lastError ? 0.85 : 0.55, color: lastError ? "#ff9b9b" : undefined, fontSize: "12px", marginTop: "3px", whiteSpace: "pre-wrap" }}>{lastError || "None recorded"}</div></div></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={reconnectFromDiagnostics}><span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Reconnect</span></ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => { setShowDiagnostics(false); setShowSettings(true); }}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to settings</span></ButtonItem></PanelSectionRow>
        </PanelSection>
      )}
      {selectedChatId && (
        <Focusable ref={conversationFocusRef} onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          const messageElement = target.closest<HTMLElement>("[data-decky-message-id]");
          setFocusedMessageId(messageElement?.dataset.deckyMessageId || "");
        }} onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeConversation();
        }}>
        <PanelSection title="Conversation">
          <PanelSectionRow><div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "2px 0 8px" }}>{selectedChat && <ContactAvatar chat={selectedChat} size={38} />}<div style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedChat?.chatName || "Conversation"}</strong><span style={{ opacity: 0.6, fontSize: "12px" }}>{history.length} messages</span></div></div></PanelSectionRow>
          <PanelSectionRow><div style={{ opacity: 0.65, fontSize: "12px" }}>A: open/select · B: back · D-pad: navigate · Select a message for actions · X: react · Y: play voice (images stay inline) · Steam+X: keyboard</div></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={closeConversation}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to contacts</span></ButtonItem></PanelSectionRow>
          {historyLoading && <PanelSectionRow><div style={{ opacity: 0.7 }}>{historyExpansionPending.current ? "Loading older messages…" : "Loading conversation…"}</div></PanelSectionRow>}
          {!historyLoading && history.length === 0 && <PanelSectionRow><div style={{ opacity: 0.7 }}>No message history</div></PanelSectionRow>}
          {!historyLoading && compactHistory && nextHistoryLimit !== undefined && <PanelSectionRow><ButtonItem layout="below" onClick={() => void loadMoreHistory()}><span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>Load more messages</span></ButtonItem></PanelSectionRow>}
          {!historyLoading && compactHistory && historyHasMore && nextHistoryLimit === undefined && <PanelSectionRow><div style={{ opacity: 0.65, fontSize: "12px" }}>History limit reached ({historyLimit} messages).</div></PanelSectionRow>}
          {displayedHistory.map((message) => (
            <Fragment key={message.id}>
            <PanelSectionRow>
              <div data-decky-message-id={message.id} onFocusCapture={() => { setFocusedMessageId(message.id); }} onKeyDown={(event) => {
                if (event.key.toLowerCase() !== "y") return;
                if (message.media?.kind === "image") {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (!messageYPress.current(message.id)) return;
                event.preventDefault();
                event.stopPropagation();
              }} style={{ width: "100%" }}>
                <ButtonItem layout="below" onClick={() => { setFocusedMessageId(message.id); setSelectedMessageId(message.id); }}>
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
          {selectedMessage && <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
            <div style={{ opacity: 0.65, fontSize: "12px" }}>Selected message actions</div>
            <ButtonItem layout="below" onClick={() => setReplyTarget({ id: selectedMessage.id, sender: selectedMessage.fromMe ? "You" : selectedMessage.sender, body: selectedMessage.body })}><span style={{ display: "flex", alignItems: "center", gap: "8px" }}><FaReply /> Reply to selected message</span></ButtonItem>
            <ButtonItem layout="below" onClick={() => { const current = ownReactions[selectedMessage.id] ?? selectedMessage.reaction ?? ""; void reactToMessage(selectedMessage.chatId, selectedMessage.id, current === reactionEmoji ? "" : reactionEmoji); }}><span>React {reactionEmoji} (X)</span></ButtonItem>
            {selectedMessage.fromMe && !selectedMessage.viewOnce && selectedMessage.ack === -1 && !selectedMessage.deliveryUncertain && !uncertainDeliveryIds.has(selectedMessage.id) && <ButtonItem layout="below" disabled={messageActionId === selectedMessage.id} onClick={() => void retryMessage(selectedMessage)}>Retry message</ButtonItem>}
            {selectedMessage.fromMe && !selectedMessage.deliveryUncertain && !uncertainDeliveryIds.has(selectedMessage.id) && !selectedMessage.id.startsWith("local-failed-") && !selectedMessage.body.startsWith("[Message deleted]") && <ButtonItem layout="below" disabled={messageActionId === selectedMessage.id} onClick={() => void deleteMessage(selectedMessage)}>Delete for everyone</ButtonItem>}
            {provider.variant === "mock" && selectedMessage.fromMe && <ButtonItem layout="below" onClick={() => { setEditingMockMessageId(selectedMessage.id); setEditingMockMessageBody(selectedMessage.body); }}>Edit mock message</ButtonItem>}
          </div></PanelSectionRow>}
          {editingMockMessageId && provider.variant === "mock" && <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <TextField label="Edit mock message" value={editingMockMessageBody} onChange={(value) => setEditingMockMessageBody(inputValue(value))} />
            <ButtonItem layout="below" onClick={async () => { const ok = await provider.editMockMessage(selectedChatId, editingMockMessageId, editingMockMessageBody); if (ok) setHistory((current) => current.map((message) => message.id === editingMockMessageId ? { ...message, body: editingMockMessageBody } : message)); setEditingMockMessageId(""); }}>Save mock edit</ButtonItem>
            <ButtonItem layout="below" onClick={() => setEditingMockMessageId("")}>Cancel mock edit</ButtonItem>
          </div></PanelSectionRow>}
          <PanelSectionRow>
            <div ref={replyFieldContainerRef} data-testid="mock-reply-field" style={{ width: "100%" }}>
              {replyTarget && <div style={{ marginBottom: "8px", padding: "8px 10px", borderLeft: "3px solid #63d2ad", background: "rgba(255,255,255,0.08)", borderRadius: "4px" }}><div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", opacity: 0.8 }}><FaReply /> Replying to {replyTarget.sender}</div><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{replyTarget.body.slice(0, 120)}</div><ButtonItem layout="below" onClick={() => setReplyTarget(undefined)}>Cancel reply</ButtonItem></div>}
              <TextField key={replyTarget?.id || "new-reply"} label="Reply" value={reply} focusOnMount={Boolean(replyTarget)} onFocus={() => { replyInputActive.current = true; }} onBlur={() => { replyInputActive.current = false; }} onChange={(value) => setReply(inputValue(value))} />
            </div>
          </PanelSectionRow>
          <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}><ButtonItem layout="below" disabled={sending || !reply.trim()} onClick={() => void sendReply()}><span aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>{sending ? "Sending…" : <><FaPaperPlane /> Send reply</>}</span></ButtonItem>{provider.voiceEnabled && <ButtonItem layout="below" disabled={voiceTypingAvailable === false} onClick={startVoiceTyping}><span style={{ display: "flex", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", fontSize: "24px", opacity: voiceTypingAvailable === false ? 0.5 : 1 }}>{voiceState === "recording" ? <FaStop aria-label="Stop recording" /> : <FaMicrophone aria-label="Voice typing" />}<span style={{ fontSize: "11px" }}>{voiceState === "recording" ? "Stop recording" : voiceTypingAvailable === false ? "Whisper not installed" : voiceState === "transcribing" ? "Transcribing…" : "Voice typing"}</span></span></ButtonItem>}</div></PanelSectionRow>
        </PanelSection>
        </Focusable>
      )}
    </>
  );
  return provider.variant === "mock"
    ? <div data-decky-provider="mock" data-decky-label="MOCK / OFFLINE" data-decky-scope="mock-panel" aria-label="MOCK / OFFLINE" style={{ display: "contents" }}>{panelContent}</div>
    : panelContent;
}

export default definePlugin(() => {
  prepareSteamListenerNamespace(provider.variant);
  // A fresh plugin load must not inherit a prior session's enabled preference.
  pluginConnectionSession.setEnabled(false);
  provider.storageSet("enabled", "false");
  stopBackgroundNotifications();

  return attachResumeRegistration({
    name: provider.pluginName,
    title: <div>{provider.label}</div>,
    content: <WhatsAppPanel />,
    icon: <FaWhatsapp />,
    onDismount: () => {
      pluginConnectionSession.setEnabled(false);
      provider.storageSet("enabled", "false");
      reconnectMountedPanel = undefined;
      stopBackgroundNotifications();
    }
  }, () => {
      runResumeRecovery(pluginConnectionSession.isEnabled(), () => {
        reconnectMountedPanel?.();
        stopBackgroundNotifications();
        startBackgroundNotifications();
      });
  }, provider.variant);
});
