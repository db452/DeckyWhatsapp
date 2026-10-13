import { call, definePlugin, toaster } from "@decky/api";
import { ButtonItem, PanelSection, PanelSectionRow, TextField } from "@decky/ui";
import { FaArrowLeft, FaClock, FaCog, FaFilter, FaMicrophone, FaPaperPlane, FaReply, FaSortAlphaDown, FaStop, FaUsers, FaWhatsapp } from "react-icons/fa";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type BridgeStatus = "starting" | "qr_required" | "authenticated" | "ready" | "disconnected" | "auth_failure" | "disabled" | "unknown";

type IncomingMessage = {
  id: string;
  chatId: string;
  chatName: string;
  sender: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
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
  | { type: "message"; message: IncomingMessage };

type ReplyTarget = {
  id: string;
  sender: string;
  body: string;
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

async function getBridgeToken(httpUrl: string): Promise<string> {
  if (bridgeToken) return bridgeToken;
  if (!bridgeTokenPromise) {
    bridgeTokenPromise = fetch(`${httpUrl.replace(/\/$/, "")}/bootstrap`, { cache: "no-store" })
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
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && !retrying) {
    resetBridgeToken();
    return bridgeFetch(input, init, true);
  }
  return response;
}

let backgroundNotificationSocket: WebSocket | undefined;
let backgroundNotificationTimer: number | undefined;
let backgroundNotificationRun = 0;

function stopBackgroundNotifications(): void {
  backgroundNotificationRun += 1;
  if (backgroundNotificationTimer !== undefined) {
    window.clearTimeout(backgroundNotificationTimer);
    backgroundNotificationTimer = undefined;
  }
  backgroundNotificationSocket?.close();
  backgroundNotificationSocket = undefined;
}

function startBackgroundNotifications(): void {
  if (window.localStorage.getItem("decky-whatsapp-enabled") !== "true") return;

  stopBackgroundNotifications();
  const run = backgroundNotificationRun;

  const connect = async () => {
    if (run !== backgroundNotificationRun || window.localStorage.getItem("decky-whatsapp-enabled") !== "true") return;
    const socket = new WebSocket(await bridgeWebSocketUrl(defaultBridgeUrl));
    backgroundNotificationSocket = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as BridgeEvent;
        if (message.type !== "message" || message.message.fromMe) return;
        toaster.toast({
          title: `WhatsApp: ${message.message.chatName}`,
          body: message.message.body || "New message",
          duration: 5000,
          playSound: true,
          showNewIndicator: true
        });
      } catch (error) {
        console.warn("[decky-whatsapp] background notification event failed", error);
      }
    };
    socket.onclose = () => {
      if (run !== backgroundNotificationRun) return;
      resetBridgeToken();
      backgroundNotificationTimer = window.setTimeout(() => {
        backgroundNotificationTimer = undefined;
        connect();
      }, 2000);
    };
  };

  connect();
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

function WhatsAppPanel() {
  const [bridgeUrl, setBridgeUrl] = useState(defaultBridgeUrl);
  const [enabled, setEnabled] = useState(() => window.localStorage.getItem("decky-whatsapp-enabled") === "true");
  const [status, setStatus] = useState<BridgeStatus>("unknown");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatSummary | undefined>();
  const [selectedChatId, setSelectedChatId] = useState("");
  const [history, setHistory] = useState<IncomingMessage[]>([]);
  const [ownReactions, setOwnReactions] = useState<Record<string, string | null>>({});
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [focusedMessageId, setFocusedMessageId] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [showSettings, setShowSettings] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [compactHistory, setCompactHistory] = useState(() => window.localStorage.getItem("decky-whatsapp-compact-history") !== "false");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [reactionEmoji, setReactionEmoji] = useState(() => {
    const saved = window.localStorage.getItem("decky-whatsapp-reaction-emoji");
    return reactionChoices.includes(saved as typeof reactionChoices[number]) ? saved as typeof reactionChoices[number] : "❤️";
  });
  const [contactMode, setContactMode] = useState<ContactMode>(() => {
    const saved = window.localStorage.getItem("decky-whatsapp-contact-mode");
    return saved === "alphabetical" || saved === "recent" || saved === "last5" || saved === "sinceSession" ? saved : "recent";
  });
  const voiceSession = useRef<VoiceSession | undefined>(undefined);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const profilePicCache = useRef<Record<string, string | null>>({});
  const profilePicRequests = useRef(new Set<string>());
  const bridgeHealthFailures = useRef(0);

  const normalizedBridgeUrl = useMemo(() => bridgeUrl.replace(/\/$/, ""), [bridgeUrl]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-contact-mode", contactMode);
  }, [contactMode]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-compact-history", String(compactHistory));
  }, [compactHistory]);

  useEffect(() => {
    window.localStorage.setItem("decky-whatsapp-reaction-emoji", reactionEmoji);
  }, [reactionEmoji]);

  const visibleChats = useMemo(() => {
    const ordered = [...chats].sort((left, right) => {
      if (contactMode === "alphabetical") return left.chatName.localeCompare(right.chatName);
      return right.timestamp - left.timestamp;
    });
    if (contactMode === "last5") return ordered.slice(0, 5);
    if (contactMode === "sinceSession") return ordered.filter((chat) => chat.receivedSinceSession);
    return ordered;
  }, [chats, contactMode]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let cancelled = false;

    if (!enabled) {
      setStatus("disabled");
      setChats([]);
      setSelectedChat(undefined);
      setSelectedChatId("");
      setHistory([]);
      return () => {
        cancelled = true;
      };
    }

    const loadChats = async () => {
      try {
        const response = await bridgeFetch(`${normalizedBridgeUrl}/chats`);
        const result = await response.json() as { chats: ChatSummary[]; hasMore?: boolean };
        console.log("[decky-whatsapp] contacts response", { count: result.chats?.length ?? 0 });
        if (!cancelled) {
          setChats(result.chats.map((chat) => ({
            ...chat,
            profilePicUrl: profilePicCache.current[chat.chatId] || undefined
          })));
          const profileQueue = [...result.chats];
          const loadProfiles = async () => {
            while (!cancelled) {
              const chat = profileQueue.shift();
              if (!chat) return;
              if (Object.prototype.hasOwnProperty.call(profilePicCache.current, chat.chatId) || profilePicRequests.current.has(chat.chatId)) continue;
              profilePicRequests.current.add(chat.chatId);
              try {
                const profileResponse = await bridgeFetch(`${normalizedBridgeUrl}/chats/${encodeURIComponent(chat.chatId)}/profile`);
                if (!profileResponse.ok) {
                  profilePicCache.current[chat.chatId] = null;
                  continue;
                }
                const profile = await profileResponse.json() as { profilePicUrl?: string | null };
                profilePicCache.current[chat.chatId] = profile.profilePicUrl || null;
                if (cancelled || !profile.profilePicUrl) continue;
                setChats((current) => current.map((item) => item.chatId === chat.chatId ? { ...item, profilePicUrl: profile.profilePicUrl || undefined } : item));
              } catch {
                // Profile pictures are optional and must not affect the contact list.
              } finally {
                profilePicRequests.current.delete(chat.chatId);
              }
            }
          };
          void Promise.all(Array.from({ length: 4 }, () => loadProfiles()));
        }
      } catch (loadError) {
        console.error("[decky-whatsapp] contacts request failed", loadError);
        // The health request reports the connection error to the user.
      }
    };

    const refreshBridgeStatus = async () => {
      try {
        const response = await bridgeFetch(`${normalizedBridgeUrl}/health`);
        if (!response.ok) throw new Error(`health check failed (${response.status})`);
        const health = await response.json() as { status: BridgeStatus };
        if (!cancelled) {
          bridgeHealthFailures.current = 0;
          setStatus(health.status);
          setError("");
        }
      } catch {
        if (!cancelled) {
          bridgeHealthFailures.current += 1;
          if (bridgeHealthFailures.current >= 3) {
            setStatus("unknown");
            setError("Bridge unavailable; retrying connection…");
          }
        }
      }
    };

    const addMessage = (incoming: IncomingMessage) => {
      setChats((current) => {
        const existing = current.find((chat) => chat.chatId === incoming.chatId);
        const updated: ChatSummary = {
          chatId: incoming.chatId,
          chatName: incoming.chatName,
          profilePicUrl: existing?.profilePicUrl,
          receivedSinceSession: true,
          lastMessage: incoming.body,
          timestamp: incoming.timestamp,
          unreadCount: existing?.unreadCount ?? 0
        };
        return [updated, ...current.filter((chat) => chat.chatId !== incoming.chatId)].slice(0, 5);
      });
      if (incoming.chatId === selectedChatId) {
        setHistory((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming]);
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer !== undefined) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, 2000);
    };

    const connect = async () => {
      try {
        const response = await bridgeFetch(`${normalizedBridgeUrl}/health`);
        const health = await response.json() as { status: BridgeStatus };
        if (!cancelled) setStatus(health.status);
        await loadChats();
        socket = new WebSocket(await bridgeWebSocketUrl(normalizedBridgeUrl));
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data) as BridgeEvent;
          if (message.type === "status") setStatus(message.status);
          if (message.type === "message") {
            addMessage(message.message);
          }
        };
        socket.onerror = () => setError("Unable to connect to the bridge");
        socket.onclose = () => {
          if (!cancelled) {
            resetBridgeToken();
            setError("Bridge connection lost; retrying…");
            scheduleReconnect();
          }
        };
      } catch {
        if (!cancelled) {
          bridgeHealthFailures.current += 1;
          if (bridgeHealthFailures.current >= 3) {
            setStatus("unknown");
            setError("Bridge unavailable; retrying connection…");
          }
        }
        scheduleReconnect();
      }
    };

    void connect();
    const polling = window.setInterval(() => {
      void refreshBridgeStatus();
      void loadChats();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(polling);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled, normalizedBridgeUrl]);

  useEffect(() => {
    if (!selectedChatId || historyLoading) return;
    let cancelled = false;
    const scrollToBottom = () => {
      if (cancelled || !conversationEndRef.current) return;
      conversationEndRef.current.focus({ preventScroll: true });
      conversationEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    };
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
      window.setTimeout(scrollToBottom, 150);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [selectedChatId, historyLoading, history.length]);

  useEffect(() => {
    const handleVoicePlaybackKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "y") return;
      const focusedMessage = history.find((message) => message.id === focusedMessageId) || history.find((message) => message.id === selectedMessageId);
      if (!focusedMessage || focusedMessage.media?.kind !== "audio") return;
      const audio = audioRefs.current[focusedMessage.id];
      if (!audio) return;
      event.preventDefault();
      if (audio.paused) void audio.play();
      else audio.pause();
    };
    window.addEventListener("keydown", handleVoicePlaybackKey);
    return () => window.removeEventListener("keydown", handleVoicePlaybackKey);
  }, [history, focusedMessageId, selectedMessageId]);

  useEffect(() => {
    const input = typeof SteamClient !== "undefined" ? SteamClient.Input : undefined;
    if (!input?.RegisterForControllerInputMessages) return;
    // Decky's controller button values: A=0, B=1, X=2, Y=3, D-pad left=7.
    const registration = input.RegisterForControllerInputMessages((_controllerIndex, gamepadButton, isButtonPressed) => {
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
      if (!isButtonPressed) return;
      if (gamepadButton === 7 && selectedChatId) {
        closeConversation();
        return;
      }
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

  const toggleEnabled = async () => {
    if (enabled) {
      await shutdownAll();
      return;
    }
    window.localStorage.setItem("decky-whatsapp-enabled", "true");
    setEnabled(true);
    startBackgroundNotifications();
    setError("");
  };

  const shutdownAll = async () => {
    stopBackgroundNotifications();
    if (voiceSession.current) {
      voiceSession.current.processor.disconnect();
      voiceSession.current.source.disconnect();
      voiceSession.current.stream.getTracks().forEach((track) => track.stop());
      void voiceSession.current.context.close();
      voiceSession.current = undefined;
      setVoiceState("idle");
    }
    setShuttingDown(true);
    try {
      await bridgeFetch(`${normalizedBridgeUrl}/shutdown`, { method: "POST" });
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

  const loadHistory = async (chatId: string, limit = compactHistory && !historyExpanded ? 5 : 50) => {
    const response = await bridgeFetch(`${normalizedBridgeUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`);
    if (!response.ok) {
      const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
      throw new Error(`History request failed (${response.status}): ${details?.error || "unknown bridge error"}`);
    }
    const result = await response.json() as { messages: IncomingMessage[]; hasMore?: boolean };
    setHistory(result.messages.map((message) => {
      if (!Object.prototype.hasOwnProperty.call(ownReactions, message.id)) return message;
      const ownReaction = ownReactions[message.id];
      const otherReactions = (message.reactions || []).filter((reaction) => reaction !== reactionEmoji && reaction !== ownReaction);
      const reactions = ownReaction ? [...new Set([...otherReactions, ownReaction])] : otherReactions;
      return { ...message, reaction: ownReaction || undefined, reactions: reactions.length > 0 ? reactions : undefined };
    }));
    setHistoryHasMore(Boolean(result.hasMore));
  };

  const selectChat = async (chat: ChatSummary) => {
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
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Unable to load conversation history");
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!selectedChatId || historyExpanded) return;
    setHistoryExpanded(true);
    setHistoryLoading(true);
    try {
      await loadHistory(selectedChatId, 50);
    } catch {
      setError("Older messages could not be loaded");
      setHistoryExpanded(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const sendReply = async () => {
    if (!selectedChatId || !reply.trim()) return;
    setError("");
    console.log("[decky-whatsapp] sending reply", { chatId: selectedChatId, quotedMessageId: replyTarget?.id, bodyLength: reply.trim().length });
    try {
      const response = await bridgeFetch(`${normalizedBridgeUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: selectedChatId, body: reply, quotedMessageId: replyTarget?.id })
      });
      if (!response.ok) {
        const details = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(details?.error || `send failed (${response.status})`);
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Message could not be sent";
      console.error("[decky-whatsapp] send failed", sendError);
      setError(message);
      return;
    }

    setReply("");
    setReplyTarget(undefined);
    setHistoryLoading(true);
    try {
      await loadHistory(selectedChatId, compactHistory && !historyExpanded ? 5 : 50);
    } catch {
      setError("Message was sent, but the conversation could not be refreshed");
    } finally {
      setHistoryLoading(false);
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
        const reactions = emoji ? [...new Set([...otherReactions, emoji])] : otherReactions;
        return { ...message, reaction: emoji || undefined, reactions: reactions.length > 0 ? reactions : undefined };
      }));
    } catch (reactionError) {
      const message = reactionError instanceof Error ? reactionError.message : "Reaction could not be sent";
      console.error("[decky-whatsapp] reaction failed", reactionError);
      setError(message);
    }
  };

  const closeConversation = () => {
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
    if (voiceState === "transcribing") return;
    if (voiceState === "recording") {
      const session = voiceSession.current;
      if (!session) return;
      session.processor.disconnect();
      session.source.disconnect();
      session.stream.getTracks().forEach((track) => track.stop());
      await session.context.close();
      voiceSession.current = undefined;
      setVoiceState("transcribing");
      setError("Transcribing…");
      try {
        const wav = encodeWav(session.chunks, session.sampleRate);
        if (session.chunks.length === 0) throw new Error("No audio was captured from the microphone");
        const transcript = await call<[string], string>("transcribe_audio", arrayBufferToBase64(wav));
        if (transcript.startsWith("__VOICE_ERROR__")) {
          throw new Error(transcript.slice("__VOICE_ERROR__".length));
        }
        if (!transcript?.trim()) throw new Error("Whisper returned no text");
        setReply((current) => current ? `${current} ${transcript.trim()}` : transcript.trim());
        toaster.toast({ title: "Voice typing", body: "Text added to your reply", duration: 3000 });
      } catch (voiceError) {
        const message = errorMessage(voiceError);
        setError(message);
        toaster.toast({ title: "Voice typing failed", body: message, duration: 6000 });
      } finally {
        setVoiceState("idle");
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      await context.resume();
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
      setError(voiceError instanceof Error ? voiceError.message : "Microphone access failed");
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
    if (!message.media && !message.image) return null;
    const media = message.media || { ...message.image!, kind: "image" as const, mimetype: "image/jpeg" };
    if (media.kind === "audio" || media.mimetype.startsWith("audio/")) {
      const playAudio = () => {
        const audio = audioRefs.current[message.id];
        if (!audio) return;
        void audio.play().catch((playError) => {
          console.error("[decky-whatsapp] voice playback failed", { messageId: message.id, error: playError });
          toaster.toast({ title: "Voice message", body: "Decky could not play this audio", duration: 5000 });
        });
      };
      return <div style={{ marginTop: "8px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>Voice message · select it and press Y</div><audio ref={(element) => { audioRefs.current[message.id] = element; }} src={media.dataUrl} aria-label="WhatsApp voice message" preload="auto" controls onError={() => { console.error("[decky-whatsapp] voice media element error", { messageId: message.id, mimetype: media.mimetype }); }} style={{ width: "100%" }} /><button type="button" onClick={(event) => { event.stopPropagation(); playAudio(); }} style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", border: "0", color: "white", background: "rgba(99, 210, 173, 0.35)" }}>▶ Play voice message</button></div>;
    }
    if (media.kind === "gif" || media.mimetype.startsWith("video/")) {
      return <div style={{ marginTop: "8px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>GIF</div><video src={media.dataUrl} aria-label={media.filename || "WhatsApp GIF"} autoPlay loop muted playsInline controls style={{ display: "block", maxWidth: "100%", maxHeight: "220px", objectFit: "contain", borderRadius: "10px" }} /></div>;
    }
    return <div style={{ marginTop: "8px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>{media.kind === "sticker" ? "Sticker" : "Image"}</div><img src={media.dataUrl} alt={media.filename || (media.kind === "sticker" ? "WhatsApp sticker" : "WhatsApp image")} style={{ display: "block", maxWidth: "100%", maxHeight: "220px", objectFit: "contain", borderRadius: "10px" }} /></div>;
  };

  const displayedHistory = compactHistory && !historyExpanded ? history.slice(-5) : history;

  return (
    <>
      <PanelSection title="WhatsApp">
        <PanelSectionRow><div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: 0.8 }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: status === "ready" ? "#63d297" : "#d49b57" }} /> Bridge: {status}</div></PanelSectionRow>
        <PanelSectionRow><ButtonItem layout="below" onClick={() => void toggleEnabled()}>{enabled ? "Stop Decky WhatsApp" : "Start Decky WhatsApp"}</ButtonItem></PanelSectionRow>
        {error && <PanelSectionRow><div style={{ color: "#ff8d8d", fontSize: "13px" }}>{error}</div></PanelSectionRow>}
      </PanelSection>
      {!selectedChatId && !showSettings && (
        <PanelSection title={`Contacts (${visibleChats.length})`}>
          {visibleChats.length === 0 && <PanelSectionRow><div style={{ opacity: 0.7, padding: "12px 0" }}>No contacts found for this setting</div></PanelSectionRow>}
          {visibleChats.map((chat) => (
            <PanelSectionRow key={chat.chatId}>
              <ButtonItem layout="below" onClick={() => void selectChat(chat)}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                  {renderAvatar(chat)}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chat.chatName}</strong>{chat.unreadCount > 0 && <span style={{ fontSize: "11px", background: "#3b9d83", borderRadius: "10px", padding: "2px 7px" }}>{chat.unreadCount}</span>}</div>
                    <div style={{ opacity: 0.62, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "3px" }}>{chat.lastMessage || "No recent message"}</div>
                  </div>
                  <FaClock style={{ opacity: 0.35, fontSize: "12px" }} />
                </div>
              </ButtonItem>
            </PanelSectionRow>
          ))}
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setShowSettings(true)}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaCog /> Settings</span></ButtonItem></PanelSectionRow>
        </PanelSection>
      )}
      {!selectedChatId && showSettings && (
        <PanelSection title="Settings">
          <PanelSectionRow><div style={{ opacity: 0.7, fontSize: "13px", padding: "4px 0 8px" }}>Choose how your WhatsApp contacts are arranged.</div></PanelSectionRow>
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
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setShowSettings(false)}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to contacts</span></ButtonItem></PanelSectionRow>
        </PanelSection>
      )}
      {selectedChatId && (
        <PanelSection title="Conversation">
          <PanelSectionRow><div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "2px 0 8px" }}>{selectedChat && renderAvatar(selectedChat, 38)}<div style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedChat?.chatName || "Conversation"}</strong><span style={{ opacity: 0.6, fontSize: "12px" }}>{history.length} messages</span></div></div></PanelSectionRow>
          <PanelSectionRow><ButtonItem layout="below" onClick={closeConversation}><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><FaArrowLeft /> Back to contacts</span></ButtonItem></PanelSectionRow>
          {historyLoading && <PanelSectionRow><div style={{ opacity: 0.7 }}>Loading conversation...</div></PanelSectionRow>}
          {!historyLoading && history.length === 0 && <PanelSectionRow><div style={{ opacity: 0.7 }}>No message history</div></PanelSectionRow>}
          {!historyLoading && compactHistory && !historyExpanded && historyHasMore && <PanelSectionRow><ButtonItem layout="below" onClick={() => void loadMoreHistory()}><span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>Load more messages</span></ButtonItem></PanelSectionRow>}
          {displayedHistory.map((message) => (
            <PanelSectionRow key={message.id}>
              <div tabIndex={0} onFocusCapture={() => setFocusedMessageId(message.id)} onKeyDown={(event) => { if (event.key.toLowerCase() !== "y" || message.media?.kind !== "audio") return; event.preventDefault(); const audio = audioRefs.current[message.id]; if (!audio) return; if (audio.paused) void audio.play(); else audio.pause(); }} style={{ width: "100%" }}>
                <ButtonItem layout="below" onClick={() => { console.log("[decky-whatsapp] selected message", { id: message.id, chatId: message.chatId, sender: message.sender }); setSelectedMessageId(message.id); setReplyTarget({ id: message.id, sender: message.fromMe ? "You" : message.sender, body: message.body }); }}>
                  <div style={{ display: "flex", justifyContent: message.fromMe ? "flex-end" : "flex-start", width: "100%" }}>
                    <div style={{ position: "relative", maxWidth: "88%", padding: "10px 12px", borderRadius: message.fromMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: message.fromMe ? "rgba(55, 128, 108, 0.5)" : "rgba(255,255,255,0.11)", border: selectedMessageId === message.id ? "2px solid rgba(126, 211, 181, 0.9)" : "2px solid transparent", textAlign: "left" }}>
                      {((message.reactions && message.reactions.length > 0) || message.reaction) && <span aria-label="Message reactions" style={{ position: "absolute", top: "-10px", right: "-8px", borderRadius: "14px", minWidth: "28px", minHeight: "28px", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px", background: "#4b2732", fontSize: "16px" }}>{(message.reactions && message.reactions.length > 0 ? message.reactions : [message.reaction]).filter((emoji): emoji is string => Boolean(emoji)).join(" ")}</span>}
                      <div style={{ fontSize: "12px", opacity: 0.68, marginBottom: message.body ? "3px" : 0 }}>{message.fromMe ? "You" : message.sender}</div>
                      {message.body && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.3 }}>{message.body}</div>}
                      {renderMedia(message)}
                      <div style={{ fontSize: "10px", opacity: 0.48, marginTop: "6px", textAlign: "right" }}>{new Date(message.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </div>
                </ButtonItem>
              </div>
            </PanelSectionRow>
          ))}
          <div ref={conversationEndRef} tabIndex={-1} aria-hidden="true" style={{ height: "1px", outline: "none" }} />
          <PanelSectionRow>
            {replyTarget && <div style={{ marginBottom: "8px", padding: "8px 10px", borderLeft: "3px solid #63d2ad", background: "rgba(255,255,255,0.08)", borderRadius: "4px" }}><div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", opacity: 0.8 }}><FaReply /> Replying to {replyTarget.sender}</div><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{replyTarget.body.slice(0, 120)}</div><ButtonItem layout="below" onClick={() => setReplyTarget(undefined)}>Cancel reply</ButtonItem></div>}
            <TextField key={replyTarget?.id || "new-reply"} label="Reply" value={reply} focusOnMount={Boolean(replyTarget)} onChange={(value) => setReply(inputValue(value))} />
          </PanelSectionRow>
          <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}><ButtonItem layout="below" onClick={() => void sendReply()}><span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}><FaPaperPlane /> Send reply</span></ButtonItem><ButtonItem layout="below" onClick={startVoiceTyping}><span style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>{voiceState === "recording" ? <FaStop aria-label="Stop recording" /> : <FaMicrophone aria-label="Voice typing" />}</span></ButtonItem></div></PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
}

export default definePlugin(() => ({
  name: "Decky WhatsApp",
  title: <div>WhatsApp</div>,
  content: <WhatsAppPanel />,
  icon: <FaWhatsapp />,
  onDismount: () => stopBackgroundNotifications()
}));

if (window.localStorage.getItem("decky-whatsapp-enabled") === "true") {
  startBackgroundNotifications();
}
