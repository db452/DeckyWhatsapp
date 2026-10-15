// Decky panel for WhatsApp conversations, notifications, preferences, and local voice typing.
import { call, definePlugin, toaster } from "@decky/api";
import { ButtonItem, Focusable, PanelSection, PanelSectionRow, Router, TextField } from "@decky/ui";
import { FaArrowLeft, FaClock, FaCog, FaFilter, FaMicrophone, FaPaperPlane, FaReply, FaSortAlphaDown, FaStop, FaUsers, FaWhatsapp } from "react-icons/fa";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { connectSocket, createQueuedRequest, fetchWithTimeout } from "./connection";
import { getConnectionHeadline, getConnectionWarning } from "./connection-state";
import { formatChatTimestamp } from "./format";

type BridgeStatus = "starting" | "qr_required" | "authenticated" | "ready" | "disconnected" | "auth_failure" | "disabled" | "unknown";
type SocketState = "connected" | "connecting" | "disconnected" | "disabled" | "unknown";
type ContactsState = "idle" | "loading" | "loaded" | "failed";

type IncomingMessage = {
  id: string;
  chatId: string;
  chatName: string;
  sender: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  ack?: number;
  deliveryUncertain?: boolean;
  mediaLoadState?: "loading" | "unavailable";
  quotedMessageId?: string;
  mediaKind?: "image" | "sticker" | "gif" | "audio";
  reaction?: string;
  reactions?: string[];
  image?: {
    dataUrl: string;
    filename?: string;
  };
  media?: {
    dataUrl: string;
    filename?: string;
    kind: "image" | "sticker" | "gif" | "audio";
    mimetype: string;
  };
};

type ChatSummary = {
  chatId: string;
  chatName: string;
  profilePicUrl?: string;
  receivedSinceSession?: boolean;
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
};

type BridgeEvent =
  | { type: "status"; status: BridgeStatus }
  | { type: "message"; message: IncomingMessage }
  | { type: "message_update"; update: "edited" | "deleted"; message: IncomingMessage }
  | { type: "message_ack"; chatId: string; messageId: string; ack: number }
  | { type: "reaction"; chatId: string; messageId: string; emoji: string; fromMe: boolean };

type ReplyTarget = {
  id: string;
  sender: string;
  body: string;
};

type VoiceTypingStatus = {
  available: boolean;
  reason?: string;
};

type HistoryReadingPosition = {
  messageId: string;
  top: number;
  scrollContainer: HTMLElement;
};

const defaultBridgeUrl = "http://127.0.0.1:8787";
let bridgeToken = "";
let bridgeTokenPromise: Promise<string> | undefined;
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

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

function avatarStyle(name: string): CSSProperties {
  const colors = ["#2f6f67", "#76558f", "#8a5c38", "#35658a", "#806b32"];
  const index = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length;
  return {
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    background: colors[index],
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontWeight: 700,
    fontSize: "14px",
    letterSpacing: "0.5px"
  };
}

function inputValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const event = value as { target?: { value?: unknown } };
    if (typeof event.target?.value === "string") return event.target.value;
  }
  return "";
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const candidate = value as { message?: unknown; error?: unknown; detail?: unknown };
    for (const item of [candidate.message, candidate.error, candidate.detail]) {
      if (typeof item === "string" && item.trim()) return item;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
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

function formatDiagnosticTime(value?: number): string {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Never";
}

function messageStatus(ack?: number, deliveryUncertain = false): { symbol: string; color: string; label: string } {
  if (deliveryUncertain) return { symbol: "?", color: "#ffbd75", label: "Delivery uncertain" };
  if (ack === -1) return { symbol: "!", color: "#ff8d8d", label: "Failed" };
  if (ack === 0) return { symbol: "…", color: "rgba(255,255,255,0.55)", label: "Sending" };
  if (ack !== undefined && ack >= 3) return { symbol: "✓✓", color: "#63b9ff", label: "Read" };
  if (ack !== undefined && ack >= 2) return { symbol: "✓✓", color: "rgba(255,255,255,0.65)", label: "Delivered" };
  return { symbol: "✓", color: "rgba(255,255,255,0.65)", label: "Sent" };
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

function isTextEntryFocused(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement) return true;
  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) return true;
  return Boolean(activeElement.closest("input, textarea, select, [contenteditable=\"true\"]"));
}

async function getBridgeToken(httpUrl: string): Promise<string> {
  if (bridgeToken) return bridgeToken;
  if (!bridgeTokenPromise) {
    bridgeTokenPromise = fetchWithTimeout(`${httpUrl.replace(/\/$/, "")}/bootstrap`, { cache: "no-store" }, 10_000)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Bridge bootstrap failed (${response.status})`);
        const result = await response.json() as { token?: unknown };
        if (typeof result.token !== "string" || !result.token) throw new Error("Bridge returned an invalid token");
        bridgeToken = result.token;
        return bridgeToken;
      })
      .finally(() => {
        bridgeTokenPromise = undefined;
      });
  }
  return bridgeTokenPromise;
}

function resetBridgeToken(): void {
  bridgeToken = "";
}

async function bridgeWebSocketUrl(httpUrl: string): Promise<string> {
  const token = await getBridgeToken(httpUrl);
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/events";
  url.search = new URLSearchParams({ token }).toString();
  return url.toString();
}

async function bridgeFetch(input: RequestInfo | URL, init: RequestInit = {}, retrying = false): Promise<Response> {
  const inputUrl = typeof input === "string" ? input : input.toString();
  const token = await getBridgeToken(new URL(inputUrl).origin);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetchWithTimeout(input, { ...init, headers });
  if (response.status === 401 && !retrying) {
    resetBridgeToken();
    return bridgeFetch(input, init, true);
  }
  return response;
}

let backgroundNotifications: ReturnType<typeof connectSocket> | undefined;
// Keep recent IDs across socket reconnects; cap this module-lifetime cache at 500.
const recentNotifiedMessageIds = new Set<string>();
const maxRememberedNotificationIds = 500;

function rememberNotifiedMessage(messageId: string): void {
  recentNotifiedMessageIds.add(messageId);
  while (recentNotifiedMessageIds.size > maxRememberedNotificationIds) {
    const oldestMessageId = recentNotifiedMessageIds.values().next().value;
    if (oldestMessageId === undefined) break;
    recentNotifiedMessageIds.delete(oldestMessageId);
  }
}

function stopBackgroundNotifications(): void {
  backgroundNotifications?.close();
  backgroundNotifications = undefined;
}

function startBackgroundNotifications(): void {
  if (
    window.localStorage.getItem("decky-whatsapp-enabled") !== "true" ||
    window.localStorage.getItem("decky-whatsapp-notifications-enabled") === "false"
  ) return;

  if (backgroundNotifications) return;
  backgroundNotifications = connectSocket({
    url: () => bridgeWebSocketUrl(defaultBridgeUrl),
    onClose: resetBridgeToken,
    onError: (error) => console.warn("[decky-whatsapp] notification connection failed; retrying", error),
    onMessage: (data) => {
      try {
        const message = JSON.parse(data) as BridgeEvent;
        if (message.type !== "message" || message.message.fromMe) return;
        const messageId = message.message.id;
        if (typeof messageId !== "string" || !messageId || recentNotifiedMessageIds.has(messageId)) return;
        if (window.localStorage.getItem("decky-whatsapp-notifications-while-gaming") === "false" && Router.MainRunningApp) return;
        const showPreview = window.localStorage.getItem("decky-whatsapp-notification-previews") !== "false";
        const soundEnabled = window.localStorage.getItem("decky-whatsapp-notification-sound") !== "false";
        toaster.toast({
          title: showPreview ? `WhatsApp: ${message.message.chatName}` : "WhatsApp message",
          body: showPreview ? (message.message.body || "New message") : "New message",
          duration: 5000,
          playSound: soundEnabled,
          showNewIndicator: true
        });
        // Record only after toast succeeds so a failed notification can be retried.
        rememberNotifiedMessage(messageId);
      } catch (error) {
        console.warn("[decky-whatsapp] background notification event failed", error);
      }
    }
  });
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
  const [bridgeUrl, setBridgeUrl] = useState(defaultBridgeUrl);
  const [enabled, setEnabled] = useState(() => window.localStorage.getItem("decky-whatsapp-enabled") === "true");
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
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [uncertainDeliveryIds, setUncertainDeliveryIds] = useState<Set<string>>(() => new Set());
  const uncertainDeliveryIdsRef = useRef(uncertainDeliveryIds);
  const [ownReactions, setOwnReactions] = useState<Record<string, string | null>>({});
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [focusedMessageId, setFocusedMessageId] = useState("");
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
  const [shuttingDown, setShuttingDown] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => window.localStorage.getItem("decky-whatsapp-notifications-enabled") !== "false");
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => window.localStorage.getItem("decky-whatsapp-notification-sound") !== "false");
  const [notificationPreviewsEnabled, setNotificationPreviewsEnabled] = useState(() => window.localStorage.getItem("decky-whatsapp-notification-previews") !== "false");
  const [notificationsWhileGaming, setNotificationsWhileGaming] = useState(() => window.localStorage.getItem("decky-whatsapp-notifications-while-gaming") !== "false");
  const [compactHistory, setCompactHistory] = useState(() => window.localStorage.getItem("decky-whatsapp-compact-history") !== "false");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyAppliedVersion, setHistoryAppliedVersion] = useState(0);
  const [reactionEmoji, setReactionEmoji] = useState(() => {
    const saved = window.localStorage.getItem("decky-whatsapp-reaction-emoji");
    return reactionChoices.includes(saved as typeof reactionChoices[number]) ? saved as typeof reactionChoices[number] : "❤️";
  });
  const [contactMode, setContactMode] = useState<ContactMode>(() => {
    const saved = window.localStorage.getItem("decky-whatsapp-contact-mode");
    return saved === "alphabetical" || saved === "recent" || saved === "last5" || saved === "sinceSession" ? saved : "recent";
  });
  const voiceSession = useRef<VoiceSession | undefined>(undefined);
  const voiceStarting = useRef(false);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const replyFieldContainerRef = useRef<HTMLDivElement | null>(null);
  const historyReadingPosition = useRef<HistoryReadingPosition | undefined>(undefined);
  const historyExpansionPending = useRef(false);
  const scrollOnOpen = useRef(false);
  const profilePicCache = useRef<Record<string, string | null>>({});
  const bridgeHealthFailures = useRef(0);
  const historyRequest = useRef<AbortController | undefined>(undefined);
  const panelMounted = useRef(true);
  const conversationRun = useRef(0);
  const historyRevision = useRef(0);

  selectedChatIdRef.current = selectedChatId;

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

  const normalizedBridgeUrl = useMemo(() => bridgeUrl.replace(/\/$/, ""), [bridgeUrl]);

  const updateStatus = (nextStatus: BridgeStatus) => {
    setStatus(nextStatus);
    setStatusUpdatedAt(Date.now());
  };

  const reportError = (message: string) => {
    setError(message);
    setLastError(message);
  };

  const reportConnectionWarning = (message: string) => {
    setLastError(message);
  };

  const activeConnectionWarning = getConnectionWarning(enabled, httpState, socketState, status);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-contact-mode", contactMode);
  }, [contactMode]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-compact-history", String(compactHistory));
  }, [compactHistory]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-reaction-emoji", reactionEmoji);
  }, [reactionEmoji]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-notifications-enabled", String(notificationsEnabled));
    if (notificationsEnabled && enabled) startBackgroundNotifications();
    else stopBackgroundNotifications();
  }, [notificationsEnabled, enabled]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-notification-sound", String(notificationSoundEnabled));
  }, [notificationSoundEnabled]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-notification-previews", String(notificationPreviewsEnabled));
  }, [notificationPreviewsEnabled]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-notifications-while-gaming", String(notificationsWhileGaming));
  }, [notificationsWhileGaming]);

  useEffect(() => {
    let cancelled = false;
    void call<[], VoiceTypingStatus>("voice_typing_status")
      .then((result) => {
        if (cancelled) return;
        setVoiceTypingAvailable(result.available);
        setVoiceTypingReason(result.reason || "");
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
    const ordered = [...chats].sort((left, right) => {
      if (contactMode === "alphabetical") return left.chatName.localeCompare(right.chatName);
      return right.timestamp - left.timestamp;
    });
    if (contactMode === "last5") return ordered.slice(0, 5);
    if (contactMode === "sinceSession") return ordered.filter((chat) => chat.receivedSinceSession);
    return ordered;
  }, [chats, contactMode]);

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
          const profileResponse = await bridgeFetch(`${normalizedBridgeUrl}/chats/${encodeURIComponent(chatId)}/profile`, { signal: controller.signal });
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
  }, [enabled, status, normalizedBridgeUrl, profileChatIds, selectedChatId, showSettings, showDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    let healthLoading = false;
    const controller = new AbortController();

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

    const loadChats = createQueuedRequest(async () => {
      if (cancelled) return;
      setContactsState((current) => current === "loaded" ? current : "loading");
      try {
        const response = await bridgeFetch(`${normalizedBridgeUrl}/chats`, { signal: controller.signal });
        if (!response.ok) throw new Error(`contacts request failed (${response.status})`);
        const result = await response.json() as { chats: ChatSummary[]; hasMore?: boolean };
        console.log("[decky-whatsapp] contacts response", { count: result.chats?.length ?? 0 });
        if (!cancelled) {
          setChats(result.chats.map((chat) => ({
            ...chat,
            profilePicUrl: profilePicCache.current[chat.chatId] || undefined
          })));
          setContactsState("loaded");
        }
      } catch (loadError) {
        if (cancelled) return;
        console.error("[decky-whatsapp] contacts request failed", loadError);
        setContactsState("failed");
      }
    });

    const refreshBridgeStatus = async () => {
      if (cancelled || healthLoading) return;
      healthLoading = true;
      try {
        const response = await bridgeFetch(`${normalizedBridgeUrl}/health`, { signal: controller.signal });
        if (!response.ok) throw new Error(`health check failed (${response.status})`);
        const health = await response.json() as { status: BridgeStatus; sessionId?: string };
        if (!cancelled) {
          bridgeHealthFailures.current = 0;
          setHttpState("connected");
          updateStatus(health.status);
          setBridgeSessionId(typeof health.sessionId === "string" ? health.sessionId : "");
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
      const messageWithMediaState = incoming.mediaKind && !incoming.media
        ? { ...incoming, mediaLoadState: "loading" as const }
        : incoming;
      setChats((current) => {
        const existing = current.find((chat) => chat.chatId === incoming.chatId);
        const updated: ChatSummary = {
          chatId: incoming.chatId,
          chatName: incoming.chatName,
          profilePicUrl: existing?.profilePicUrl,
          receivedSinceSession: existing?.receivedSinceSession || !incoming.fromMe,
          lastMessage: incoming.body,
          timestamp: incoming.timestamp,
          unreadCount: existing ? existing.unreadCount + (incoming.fromMe || incoming.chatId === selectedChatIdRef.current ? 0 : 1) : (incoming.fromMe ? 0 : 1)
        };
        return [updated, ...current.filter((chat) => chat.chatId !== incoming.chatId)];
      });
      if (incoming.chatId === selectedChatIdRef.current) {
        historyRevision.current += 1;
        setHistory((current) => current.some((message) => message.id === incoming.id) ? current : [...current, messageWithMediaState]);
      }
    };

    const updateChatPreview = (message: IncomingMessage) => {
      setChats((current) => current.map((chat) => chat.chatId === message.chatId && message.timestamp >= chat.timestamp
        ? { ...chat, chatName: message.chatName, lastMessage: message.body, timestamp: message.timestamp }
        : chat));
    };

    let lastStatus: BridgeStatus = "unknown";
    setSocketState("connecting");
    setHttpState("connecting");
    const connection = connectSocket({
      url: () => bridgeWebSocketUrl(normalizedBridgeUrl),
      onOpen: () => {
        setSocketState("connected");
        bridgeHealthFailures.current = 0;
        void refreshBridgeStatus();
      },
      onMessage: (data) => {
          const message = JSON.parse(data) as BridgeEvent;
          if (message.type === "status") {
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
            setHistory((current) => current.map((existing) => existing.id !== message.message.id ? existing
              : message.update === "deleted" ? { ...existing, ...message.message, reaction: undefined, reactions: undefined }
              : { ...existing, body: message.message.body }));
          }
          if (message.type === "message_ack") {
            setHistory((current) => current.map((existing) => existing.id === message.messageId ? { ...existing, ack: message.ack } : existing));
          }
          if (message.type === "reaction") {
            setHistory((current) => current.map((existing) => {
              if (existing.id !== message.messageId) return existing;
              const ownReaction = message.fromMe ? (message.emoji || undefined) : existing.reaction;
              const reactions = (existing.reactions || []).filter((reaction) => !message.fromMe || reaction !== existing.reaction);
              if (message.emoji) reactions.push(message.emoji);
              return { ...existing, reaction: ownReaction, reactions: uniqueReactions(reactions) };
            }));
            if (message.fromMe) setOwnReactions((current) => ({ ...current, [message.messageId]: message.emoji || null }));
          }
      },
      onError: () => {
          setSocketState("disconnected");
          reportConnectionWarning("WebSocket disconnected. Reconnecting…");
      },
      onClose: () => {
            setSocketState("disconnected");
            resetBridgeToken();
            lastStatus = "unknown";
            reportConnectionWarning("WebSocket disconnected. Reconnecting…");
      }
    });

    const polling = window.setInterval(() => {
      void refreshBridgeStatus();
      // WebSocket events are the primary synchronization path. Only refresh
      // the full chat list when the socket is not currently connected.
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
  }, [enabled, normalizedBridgeUrl, connectionRefresh]);

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
          historyReadingPosition.current = undefined;
          setHistoryExpanded(false);
          setHistoryLoading(false);
          reportError("Older messages could not be loaded");
        }
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [historyRefresh]);

  useEffect(() => {
    if (!selectedChatId || historyLoading || !scrollOnOpen.current) return;
    let cancelled = false;
    let timer: number | undefined;
    const scrollToBottom = () => {
      if (cancelled || !conversationEndRef.current || isTextEntryFocused() || replyInputActive.current) return;
      conversationEndRef.current.focus({ preventScroll: true });
      conversationEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    };
    const frame = window.requestAnimationFrame(() => {
      scrollOnOpen.current = false;
      scrollToBottom();
      timer = window.setTimeout(scrollToBottom, 150);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [selectedChatId, historyLoading, history.length]);

  useEffect(() => {
    // Restore position only after expanded history applies; discarded requests leave the anchor pending.
    const anchor = historyReadingPosition.current;
    if (!anchor || !historyExpanded || historyLoading || historyExpansionPending.current) return;
    const frame = window.requestAnimationFrame(() => {
      const messageElement = Array.from(document.querySelectorAll<HTMLElement>("[data-decky-message-id]"))
        .find((element) => element.dataset.deckyMessageId === anchor.messageId);
      if (messageElement) {
        anchor.scrollContainer.scrollTop += messageElement.getBoundingClientRect().top - anchor.top;
      }
      historyReadingPosition.current = undefined;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historyExpanded, historyLoading, history.length, historyAppliedVersion]);

  useEffect(() => {
    const input = typeof SteamClient !== "undefined" ? SteamClient.Input : undefined;
    if (!input?.RegisterForControllerInputMessages) return;
    // Decky's controller button values: X=2 and Y=3. Leave navigation and back
    // handling to SteamOS so the plugin does not replace system controls.
    const registration = input.RegisterForControllerInputMessages((_controllerIndex, gamepadButton, isButtonPressed) => {
      if (isTextEntryFocused() || replyInputActive.current) return;
      if (isButtonPressed && gamepadButton === 2) {
        if (isTextEntryFocused() || replyInputActive.current) return;
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
      if (!isButtonPressed) return;
      if (gamepadButton !== 3) return;
      const focusedMessage = history.find((message) => message.id === focusedMessageId) || history.find((message) => message.id === selectedMessageId);
      if (!focusedMessage) return;
      if (focusedMessage.media?.kind !== "audio") return;
      const audio = audioRefs.current[focusedMessage.id];
      if (!audio) return;
      if (audio.paused) void audio.play();
      else audio.pause();
    });
    return () => {
      registration.unregister();
    };
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

  const toggleEnabled = async () => {
    if (enabled) {
      await shutdownAll();
      return;
    }
    window.localStorage.setItem("decky-whatsapp-enabled", "true");
    setEnabled(true);
    setError("");
  };

  const reconnectFromDiagnostics = () => {
    bridgeHealthFailures.current = 0;
    setSocketState("connecting");
    setHttpState("connecting");
    setConnectionRefresh((current) => current + 1);
  };

  const shutdownAll = async () => {
    if (shuttingDown) return;
    window.localStorage.setItem("decky-whatsapp-enabled", "false");
    setEnabled(false);
    stopBackgroundNotifications();
    closeConversation();
    setShuttingDown(true);
    try {
      const response = await bridgeFetch(`${normalizedBridgeUrl}/shutdown`, { method: "POST" });
      if (!response.ok) throw new Error(`shutdown failed (${response.status})`);
      toaster.toast({ title: "Decky WhatsApp", body: "Bridge and SSH tunnel shutting down", duration: 4000 });
    } catch {
      toaster.toast({ title: "Decky WhatsApp", body: "Could not reach the PC bridge", duration: 5000 });
    } finally {
      window.localStorage.setItem("decky-whatsapp-enabled", "false");
      setEnabled(false);
      setShowSettings(false);
      setShuttingDown(false);
    }
  };

  // Conversation history, message actions, and navigation.
  const loadHistory = async (chatId: string, limit = compactHistory && !historyExpanded ? 5 : 50) => {
    if (!panelMounted.current || selectedChatIdRef.current !== chatId) return false;
    if (historyExpansionPending.current && limit < 50) {
      setHistoryRefresh((current) => current + 1);
      return false;
    }
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    const revision = historyRevision.current;
    try {
      const response = await bridgeFetch(`${normalizedBridgeUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`, { signal: controller.signal });
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(`History request failed (${response.status}): ${details?.error || "unknown bridge error"}`);
      }
      const result = await response.json() as { messages: IncomingMessage[]; hasMore?: boolean };
      if (controller.signal.aborted || !panelMounted.current || selectedChatIdRef.current !== chatId) return false;
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
        const existingById = new Map(current.map((message) => [message.id, message]));
        const hydratedMessages = messages.map((message) => {
          const existing = existingById.get(message.id);
          const hasUnavailableMedia = !message.media && !message.image && Boolean(
            message.mediaKind || hasMediaFallbackBody(message.body) || existing?.mediaKind || existing?.media
            || existing?.image || existing?.mediaLoadState === "loading"
          );
          return { ...message, mediaLoadState: hasUnavailableMedia ? "unavailable" as const : undefined };
        });
        return [...hydratedMessages, ...current.filter((message) => message.chatId === chatId && message.id.startsWith("local-failed-"))];
      });
      if (historyExpansionPending.current) {
        // Rebase just before apply because the reader may scroll while this request is in flight.
        const anchor = historyReadingPosition.current;
        const messageElement = anchor && selectedChatIdRef.current === chatId
          ? Array.from(document.querySelectorAll<HTMLElement>("[data-decky-message-id]"))
            .find((element) => element.dataset.deckyMessageId === anchor.messageId)
          : undefined;
        if (anchor && messageElement) anchor.top = messageElement.getBoundingClientRect().top;
        else historyReadingPosition.current = undefined;
      }
      setHistoryHasMore(Boolean(result.hasMore));
      setHistoryAppliedVersion((current) => current + 1);
      if (historyExpansionPending.current) {
        historyExpansionPending.current = false;
        setHistoryLoading(false);
      }
      return true;
    } catch (historyError) {
      if (!controller.signal.aborted) throw historyError;
      return false;
    }
  };

  const selectChat = async (chat: ChatSummary) => {
    const run = ++conversationRun.current;
    historyExpansionPending.current = false;
    historyReadingPosition.current = undefined;
    scrollOnOpen.current = true;
    selectedChatIdRef.current = chat.chatId;
    setSelectedMessageId("");
    setReplyTarget(undefined);
    setSelectedChat(chat);
    setSelectedChatId(chat.chatId);
    setHistory([]);
    setHistoryExpanded(false);
    setHistoryHasMore(false);
    setFocusedMessageId("");
    setHistoryLoading(true);
    setError("");
    try {
      await loadHistory(chat.chatId, compactHistory ? 5 : 50);
      if (conversationRun.current !== run || selectedChatIdRef.current !== chat.chatId || !panelMounted.current) return;
      // Only mark the conversation read after it is open and its history request
      // completed. Retry transient failures without delaying conversation display.
      void bridgeFetch(`${normalizedBridgeUrl}/chats/${encodeURIComponent(chat.chatId)}/read`, { method: "POST" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`mark-read request failed (${response.status})`);
          const result = await response.json() as { marked?: boolean };
          if (!result.marked) throw new Error("WhatsApp did not confirm the conversation was read");
          if (selectedChatIdRef.current === chat.chatId && panelMounted.current) {
            setChats((current) => current.map((item) => item.chatId === chat.chatId ? { ...item, unreadCount: 0 } : item));
          }
        })
        .catch((error) => console.warn("[decky-whatsapp] could not mark conversation as read", { chatId: chat.chatId, error }));
    } catch (selectionError) {
      if (conversationRun.current === run && panelMounted.current) reportError(selectionError instanceof Error ? selectionError.message : "Unable to load conversation history");
    } finally {
      if (conversationRun.current === run && panelMounted.current) setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!selectedChatId || historyExpanded) return;
    const run = conversationRun.current;
    const visibleMessage = Array.from(document.querySelectorAll<HTMLElement>("[data-decky-message-id]"))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
    if (visibleMessage) {
      let scrollContainer = visibleMessage.parentElement;
      while (scrollContainer && scrollContainer !== document.body) {
        const overflowY = window.getComputedStyle(scrollContainer).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && scrollContainer.scrollHeight > scrollContainer.clientHeight) break;
        scrollContainer = scrollContainer.parentElement;
      }
      historyReadingPosition.current = {
        messageId: visibleMessage.dataset.deckyMessageId || "",
        top: visibleMessage.getBoundingClientRect().top,
        scrollContainer: scrollContainer || document.scrollingElement as HTMLElement || document.documentElement
      };
    } else {
      historyReadingPosition.current = undefined;
    }
    historyExpansionPending.current = true;
    setHistoryExpanded(true);
    setHistoryLoading(true);
    try {
      await loadHistory(selectedChatId, 50);
    } catch {
      if (conversationRun.current !== run || !panelMounted.current) return;
      // Expansion may replace an aborted media refresh, so settle its placeholders if expansion fails.
      setHistory((current) => current.map((message) => message.mediaLoadState === "loading"
        ? { ...message, mediaLoadState: "unavailable" }
        : message));
      reportError("Older messages could not be loaded");
      setHistoryExpanded(false);
      historyExpansionPending.current = false;
      historyReadingPosition.current = undefined;
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
        const response = await bridgeFetch(`${normalizedBridgeUrl}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, body, quotedMessageId })
        });
        receivedHttpResponse = true;
        if (!response.ok) {
          const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
          throw new Error(details?.error || `send failed (${response.status})`);
        }
      } catch (sendError) {
        const uncertain = !receivedHttpResponse;
        const message = uncertain
          ? "No send confirmation received. Delivery is uncertain; check WhatsApp before retrying."
          : sendError instanceof Error ? sendError.message : "Message could not be sent";
        console.error("[decky-whatsapp] send failed", sendError);
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
          quotedMessageId,
          deliveryUncertain: uncertain,
          ack: -1
        }]);
        return;
      }

      if (!stillActive()) return;
      setReply((current) => current === draft ? "" : current);
      setReplyTarget((current) => current?.id === quotedMessageId ? undefined : current);
      setSelectedMessageId((current) => current === selectedMessageId ? "" : current);
      setHistoryLoading(true);
      try {
        await loadHistory(chatId, compactHistory && !historyExpanded ? 5 : 50);
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
      const response = await bridgeFetch(`${normalizedBridgeUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: message.chatId, body: message.body, quotedMessageId: message.quotedMessageId })
      });
      receivedHttpResponse = true;
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(details?.error || `retry failed (${response.status})`);
      }
      if (!panelMounted.current || conversationRun.current !== run) return;
      setHistory((current) => current.filter((currentMessage) => currentMessage.id !== message.id));
      await loadHistory(selectedChatId, compactHistory && !historyExpanded ? 5 : 50);
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
            ? { ...currentMessage, deliveryUncertain: true }
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
      const response = await bridgeFetch(`${normalizedBridgeUrl}/messages/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: message.chatId, messageId: message.id })
      });
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
      toaster.toast({ title: "WhatsApp", body: "Message deleted", duration: 2500 });
    } catch (deleteError) {
      if (panelMounted.current && conversationRun.current === run) reportError(deleteError instanceof Error ? deleteError.message : "Message could not be deleted");
    } finally {
      actionInFlight.current = false;
      if (panelMounted.current) setMessageActionId("");
    }
  };

  const reactToMessage = async (chatId: string, messageId: string, emoji: string = reactionEmoji) => {
    try {
      const response = await bridgeFetch(`${normalizedBridgeUrl}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, messageId, emoji })
      });
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(details?.error || `reaction failed (${response.status})`);
      }
      if (selectedChatId) await loadHistory(selectedChatId, compactHistory && !historyExpanded ? 5 : 50);
      setOwnReactions((current) => ({ ...current, [messageId]: emoji || null }));
      setHistory((current) => current.map((message) => {
        if (message.id !== messageId) return message;
        const otherReactions = (message.reactions || []).filter((reaction) => reaction !== reactionEmoji && reaction !== emoji);
        const reactions = emoji ? [...otherReactions, emoji] : otherReactions;
        return { ...message, reaction: emoji || undefined, reactions: uniqueReactions(reactions) };
      }));
    } catch (reactionError) {
      const message = reactionError instanceof Error ? reactionError.message : "Reaction could not be sent";
      console.error("[decky-whatsapp] reaction failed", reactionError);
      reportError(message);
    }
  };

  const closeConversation = () => {
    pendingContactFocusId.current = selectedChatIdRef.current;
    historyExpansionPending.current = false;
    historyReadingPosition.current = undefined;
    replyInputActive.current = false;
    conversationRun.current += 1;
    selectedChatIdRef.current = "";
    historyRequest.current?.abort();
    stopRecording();
    setVoiceState("idle");
    setSelectedChat(undefined);
    setSelectedChatId("");
    setHistory([]);
    setHistoryExpanded(false);
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
        const transcript = await call<[string], string>("transcribe_audio", arrayBufferToBase64(wav));
        if (!stillActive()) return;
        if (transcript.startsWith("__VOICE_ERROR__")) {
          const details = transcript.slice("__VOICE_ERROR__".length);
          if (/marker|not installed|executable|model is missing|path is empty/i.test(details)) {
            setVoiceTypingAvailable(false);
            setVoiceTypingReason(details);
          }
          throw new Error(details);
        }
        if (!transcript?.trim()) throw new Error("Whisper returned no text");
        setReply((current) => current ? `${current} ${transcript.trim()}` : transcript.trim());
        setError("");
        toaster.toast({ title: "Voice typing", body: "Text added to your reply", duration: 3000 });
      } catch (voiceError) {
        if (!stillActive()) return;
        const message = errorMessage(voiceError);
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
    } catch (voiceError) {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      if (stillActive()) reportError(voiceError instanceof Error ? voiceError.message : "Microphone access failed");
    } finally {
      voiceStarting.current = false;
    }
  };

  const renderAvatar = (chat: ChatSummary, size = 42) => chat.profilePicUrl ? (
    <img src={chat.profilePicUrl} alt="" style={{ width: `${size}px`, height: `${size}px`, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
  ) : (
    <div aria-label="Generic profile picture" style={{ ...avatarStyle(chat.chatName), width: `${size}px`, height: `${size}px` }}>
      {initials(chat.chatName)}
    </div>
  );

  const renderMedia = (message: IncomingMessage) => {
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
        void audio.play().catch((playError) => {
          console.error("[decky-whatsapp] voice playback failed", { messageId: message.id, error: playError });
          toaster.toast({ title: "Voice message", body: "Decky could not play this audio", duration: 5000 });
        });
      };
      return <div style={{ marginTop: "8px", minHeight: "112px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>Voice message · select it and press Y</div><audio ref={(element) => { audioRefs.current[message.id] = element; }} src={media.dataUrl} aria-label="WhatsApp voice message" preload="auto" controls onError={() => { markMediaUnavailable(message.id); console.error("[decky-whatsapp] voice media element error", { messageId: message.id, mimetype: media.mimetype }); }} style={{ width: "100%" }} /><button type="button" onClick={(event) => { event.stopPropagation(); playAudio(); }} style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", border: "0", color: "white", background: "rgba(99, 210, 173, 0.35)" }}>▶ Play voice message</button></div>;
    }
    if (media.kind === "gif" || media.mimetype.startsWith("video/")) {
      return <div style={{ marginTop: "8px", height: "180px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>GIF</div><video src={media.dataUrl} aria-label={media.filename || "WhatsApp GIF"} autoPlay loop muted playsInline controls onError={() => markMediaUnavailable(message.id)} style={{ display: "block", width: "100%", height: "156px", objectFit: "contain", borderRadius: "10px" }} /></div>;
    }
    return <div style={{ marginTop: "8px", height: "180px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>{media.kind === "sticker" ? "Sticker" : "Image"}</div><img src={media.dataUrl} alt={media.filename || (media.kind === "sticker" ? "WhatsApp sticker" : "WhatsApp image")} onError={() => markMediaUnavailable(message.id)} style={{ display: "block", width: "100%", height: "156px", objectFit: "contain", borderRadius: "10px" }} /></div>;
  };

  const displayedHistory = compactHistory && !historyExpanded ? history.slice(-5) : history;
  const selectedMessage = selectedMessageId ? history.find((message) => message.id === selectedMessageId) : undefined;

  return (
    <>
      <PanelSection title="WhatsApp">
        <PanelSectionRow><div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: 0.8 }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: getConnectionHeadline(enabled, httpState, socketState, status) === "Connected" ? "#63d297" : "#d49b57" }} /> {getConnectionHeadline(enabled, httpState, socketState, status)}</div></PanelSectionRow>
        <PanelSectionRow><ButtonItem layout="below" onClick={() => void toggleEnabled()}>{enabled ? "Stop Decky WhatsApp" : "Start Decky WhatsApp"}</ButtonItem></PanelSectionRow>
        {activeConnectionWarning && <PanelSectionRow><div style={{ color: "#ffbd75", fontSize: "13px" }}>{activeConnectionWarning}</div></PanelSectionRow>}
        {error && <PanelSectionRow><div style={{ color: "#ff8d8d", fontSize: "13px" }}>{error}</div></PanelSectionRow>}
      </PanelSection>
      {!selectedChatId && !showSettings && !showDiagnostics && (
        <PanelSection title={`Contacts (${visibleChats.length})`}>
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
              <div data-decky-chat-id={chat.chatId}>
              <ButtonItem layout="below" onClick={() => void selectChat(chat)}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                  {renderAvatar(chat)}
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
          <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "4px 0 8px" }}>Choose how your WhatsApp contacts are arranged.</div></PanelSectionRow>
          <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "8px 0 2px" }}>Notifications</div></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setNotificationsEnabled((current) => !current)}><div style={{ textAlign: "left" }}><strong>{notificationsEnabled ? "✓ " : ""}Show notifications</strong><div style={{ opacity: 0.6, fontSize: "12px", marginTop: "3px" }}>Show a Decky notification when a new WhatsApp message arrives.</div></div></ButtonItem></PanelSectionRow>
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
          <PanelSectionRow><div><strong>WhatsApp Web</strong><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{status}</div></div></PanelSectionRow>
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
        <Focusable onCancel={(event) => {
          if (isTextEntryFocused() || replyInputActive.current) return;
          event.preventDefault();
          event.stopPropagation();
          closeConversation();
        }}>
        <PanelSection title="Conversation">
          <PanelSectionRow><div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "2px 0 8px" }}>{selectedChat && renderAvatar(selectedChat, 38)}<div style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedChat?.chatName || "Conversation"}</strong><span style={{ opacity: 0.6, fontSize: "12px" }}>{history.length} messages</span></div></div></PanelSectionRow>
          <PanelSectionRow><div style={{ opacity: 0.65, fontSize: "12px" }}>A: open/select · B: back · D-pad: navigate · Select a message for actions · X: react · Y: play/pause voice · Steam+X: keyboard</div></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={closeConversation}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to contacts</span></ButtonItem></PanelSectionRow>
          {historyLoading && <PanelSectionRow><div style={{ opacity: 0.7 }}>{historyExpanded ? "Loading older messages…" : "Loading conversation…"}</div></PanelSectionRow>}
          {!historyLoading && history.length === 0 && <PanelSectionRow><div style={{ opacity: 0.7 }}>No message history</div></PanelSectionRow>}
          {!historyLoading && compactHistory && !historyExpanded && (historyHasMore || history.length > 5) && <PanelSectionRow><ButtonItem layout="below" onClick={() => void loadMoreHistory()}><span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>Load more messages</span></ButtonItem></PanelSectionRow>}
          {displayedHistory.map((message) => (
            <Fragment key={message.id}>
            <PanelSectionRow>
              <div data-decky-message-id={message.id} tabIndex={0} onFocusCapture={() => setFocusedMessageId(message.id)} onKeyDown={(event) => { if (event.key.toLowerCase() !== "y" || message.media?.kind !== "audio") return; event.preventDefault(); const audio = audioRefs.current[message.id]; if (!audio) return; if (audio.paused) void audio.play(); else audio.pause(); }} style={{ width: "100%" }}>
                <ButtonItem layout="below" onClick={() => { setFocusedMessageId(message.id); setSelectedMessageId(message.id); }}>
                  <div style={{ display: "flex", justifyContent: message.fromMe ? "flex-end" : "flex-start", width: "100%" }}>
                    <div style={{ position: "relative", maxWidth: "88%", padding: "10px 12px", borderRadius: message.fromMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: message.fromMe ? "rgba(55, 128, 108, 0.5)" : "rgba(255,255,255,0.11)", border: selectedMessageId === message.id ? "2px solid rgba(126, 211, 181, 0.9)" : "2px solid transparent", textAlign: "left" }}>
                      {(() => {
                        const reactions = uniqueReactions(message.reactions && message.reactions.length > 0 ? message.reactions : message.reaction ? [message.reaction] : undefined);
                        return reactions && <span aria-label="Message reactions" style={{ position: "absolute", top: "-10px", right: "-8px", borderRadius: "14px", minWidth: "28px", minHeight: "28px", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px", background: "#4b2732", fontSize: "16px" }}>{reactions.join(" ")}</span>;
                      })()}
                      <div style={{ fontSize: "12px", opacity: 0.68, marginBottom: message.body ? "3px" : 0 }}>{message.fromMe ? "You" : message.sender}</div>
                      {message.body && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.3 }}>{message.body}</div>}
                      {renderMedia(message)}
                      <div style={{ fontSize: "10px", opacity: 0.58, marginTop: "6px", textAlign: "right" }}>
                        {new Date(message.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {message.fromMe && <span title={messageStatus(message.ack, message.deliveryUncertain).label} aria-label={messageStatus(message.ack, message.deliveryUncertain).label} style={{ marginLeft: "5px", color: messageStatus(message.ack, message.deliveryUncertain).color, fontWeight: 700 }}>{messageStatus(message.ack, message.deliveryUncertain).symbol}</span>}
                      </div>
                    </div>
                  </div>
                </ButtonItem>
              </div>
            </PanelSectionRow>
            </Fragment>
          ))}
          {selectedMessage && <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
            <div style={{ opacity: 0.65, fontSize: "12px" }}>Selected message actions</div>
            <ButtonItem layout="below" onClick={() => setReplyTarget({ id: selectedMessage.id, sender: selectedMessage.fromMe ? "You" : selectedMessage.sender, body: selectedMessage.body })}><span style={{ display: "flex", alignItems: "center", gap: "8px" }}><FaReply /> Reply to selected message</span></ButtonItem>
            <ButtonItem layout="below" onClick={() => { const current = ownReactions[selectedMessage.id] ?? selectedMessage.reaction ?? ""; void reactToMessage(selectedMessage.chatId, selectedMessage.id, current === reactionEmoji ? "" : reactionEmoji); }}><span>React {reactionEmoji} (X)</span></ButtonItem>
            {selectedMessage.fromMe && selectedMessage.ack === -1 && !selectedMessage.deliveryUncertain && !uncertainDeliveryIds.has(selectedMessage.id) && <ButtonItem layout="below" disabled={messageActionId === selectedMessage.id} onClick={() => void retryMessage(selectedMessage)}>Retry message</ButtonItem>}
            {selectedMessage.fromMe && !selectedMessage.deliveryUncertain && !uncertainDeliveryIds.has(selectedMessage.id) && !selectedMessage.id.startsWith("local-failed-") && !selectedMessage.body.startsWith("[Message deleted]") && <ButtonItem layout="below" disabled={messageActionId === selectedMessage.id} onClick={() => void deleteMessage(selectedMessage)}>Delete for everyone</ButtonItem>}
          </div></PanelSectionRow>}
          <div ref={conversationEndRef} tabIndex={-1} aria-hidden="true" style={{ height: "1px", outline: "none" }} />
          <PanelSectionRow>
            <div ref={replyFieldContainerRef} style={{ width: "100%" }}>
              {replyTarget && <div style={{ marginBottom: "8px", padding: "8px 10px", borderLeft: "3px solid #63d2ad", background: "rgba(255,255,255,0.08)", borderRadius: "4px" }}><div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", opacity: 0.8 }}><FaReply /> Replying to {replyTarget.sender}</div><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{replyTarget.body.slice(0, 120)}</div><ButtonItem layout="below" onClick={() => setReplyTarget(undefined)}>Cancel reply</ButtonItem></div>}
              <TextField key={replyTarget?.id || "new-reply"} label="Reply" value={reply} focusOnMount={Boolean(replyTarget)} onFocus={() => { replyInputActive.current = true; }} onBlur={() => { replyInputActive.current = false; }} onChange={(value) => setReply(inputValue(value))} />
            </div>
          </PanelSectionRow>
          <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}><ButtonItem layout="below" disabled={sending || !reply.trim()} onClick={() => void sendReply()}><span aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>{sending ? "Sending…" : <><FaPaperPlane /> Send reply</>}</span></ButtonItem><ButtonItem layout="below" disabled={voiceTypingAvailable === false} onClick={startVoiceTyping}><span style={{ display: "flex", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", fontSize: "24px", opacity: voiceTypingAvailable === false ? 0.5 : 1 }}>{voiceState === "recording" ? <FaStop aria-label="Stop recording" /> : <FaMicrophone aria-label="Voice typing" />}<span style={{ fontSize: "11px" }}>{voiceState === "recording" ? "Stop recording" : voiceTypingAvailable === false ? "Whisper not installed" : voiceState === "transcribing" ? "Transcribing…" : "Voice typing"}</span></span></ButtonItem></div></PanelSectionRow>
        </PanelSection>
        </Focusable>
      )}
    </>
  );
}

export default definePlugin(() => ({
  name: "Decky WhatsApp",
  title: <div>WhatsApp</div>,
  content: <WhatsAppPanel />,
  icon: <FaWhatsapp />,
  onDismount: stopBackgroundNotifications
}));
