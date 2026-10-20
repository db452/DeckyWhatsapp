// Decky panel for WhatsApp conversations, notifications, preferences, and local voice typing.
import { definePlugin, toaster } from "@decky/api";
import { ButtonItem, Focusable, NavEntryPositionPreferences, PanelSection, PanelSectionRow, Router } from "@decky/ui";
import { FaWhatsapp } from "react-icons/fa";
import { useEffect, useMemo, useRef, useState } from "react";
import { provider } from "./providers/provider-selected";
import { createMockProviderLifecycle } from "./providers/mock-provider-lifecycle";
import { createPluginConnectionSession, getConnectionHeadline, getConnectionToggleLabel, getConnectionWarning, runResumeRecovery } from "./connection/connection-state";
import { getNextHistoryLimit } from "./messages/history";
import { createNotificationIdCache } from "./notifications/notification-id-cache";
import { createNotificationSession } from "./notifications/notification-session";
import { getReactionNotification } from "./notifications/reaction-notification";
import { prepareSteamListenerNamespace, registerControllerInputMessages } from "./platform/steam-compat";
import { attachResumeRegistration } from "./plugin-lifecycle";
import { ConversationMessages } from "./components/ConversationMessages";
import { ContactBrowser } from "./components/ContactBrowser";
import type { ContactsState } from "./components/ContactBrowser";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { SelectedMessageActions } from "./components/SelectedMessageActions";
import { ReplyComposer } from "./components/ReplyComposer";
import type { ReplyTarget } from "./types/conversation";
import { MessageMedia } from "./components/MessageMedia";
import { reactionChoices, SettingsPanel } from "./components/SettingsPanel";
import type { ContactMode } from "./components/SettingsPanel";
import { useVoiceTyping } from "./hooks/useVoiceTyping";
import { useConversationHistory } from "./hooks/useConversationHistory";
import { useBridgeConnection } from "./hooks/useBridgeConnection";
import { useConversationActions } from "./hooks/useConversationActions";
import { createMessageYPressHandler, getMessageYAction } from "./messages/message-actions";
import type { ChatSummary } from "./types/chat";
import type { IncomingMessage } from "./types/message";

let reconnectMountedPanel: (() => void) | undefined;
const pluginConnectionSession = createPluginConnectionSession();
// ControllerInputGamepadButton.GAMEPAD_BUTTON_Y in the installed @decky/ui declaration.
const steamControllerYButton = 3;
function inputValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const event = value as { target?: { value?: unknown } };
    if (typeof event.target?.value === "string") return event.target.value;
  }
  return "";
}

function compareRecentChats(left: ChatSummary, right: ChatSummary): number {
  return right.timestamp - left.timestamp || left.chatId.localeCompare(right.chatId);
}

function isTextEntryFocused(ownerDocument: Document = document): boolean {
  const activeElement = ownerDocument.activeElement;
  return Boolean(activeElement && (
    activeElement.matches("input, textarea, select") ||
    (activeElement as HTMLElement).isContentEditable
  ));
}

let backgroundNotifications: ReturnType<typeof provider.subscribe> | undefined;
const backgroundNotificationSession = createNotificationSession();
const mockProviderLifecycle = provider.variant === "mock" ? createMockProviderLifecycle(provider) : undefined;
function subscribeProvider(onEvent: Parameters<typeof provider.subscribe>[0], onOpen: Parameters<typeof provider.subscribe>[1], onError: Parameters<typeof provider.subscribe>[2], onClose: Parameters<typeof provider.subscribe>[3]) {
  return mockProviderLifecycle?.subscribe(onEvent, onOpen, onError, onClose)
    ?? provider.subscribe(onEvent, onOpen, onError, onClose);
}
// Keep recent IDs across socket reconnects; cap this module-lifetime cache at 500.
const recentNotifiedMessageIds = createNotificationIdCache(500);
const recentNotifiedReactionIds = createNotificationIdCache(500);

function stopBackgroundNotifications(): void {
  backgroundNotificationSession.close();
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
    if (event.type === "reaction") {
      const reaction = getReactionNotification(event);
      if (!reaction) return;
      const sessionActive = provider.storageGet("notifications-enabled") !== "false" &&
        provider.storageGet("enabled") === "true" && backgroundNotifications?.connected === true;
      if (!backgroundNotificationSession.accepts(reaction.timestamp, sessionActive)) return;
      if (recentNotifiedReactionIds.has(reaction.id)) return;
      if (provider.storageGet("notifications-while-gaming") === "false" && Router.MainRunningApp) return;
      const showPreview = provider.storageGet("notification-previews") !== "false";
      toaster.toast({
        title: showPreview ? "Reaction to your message" : "New reaction",
        body: showPreview ? reaction.emoji : "Someone reacted to your message",
        duration: 5000,
        playSound: provider.storageGet("notification-sound") !== "false",
        showNewIndicator: true
      });
      recentNotifiedReactionIds.remember(reaction.id);
      return;
    }
    if (event.type !== "message" || event.message.fromMe) return;
    const sessionActive = provider.storageGet("notifications-enabled") !== "false" &&
      provider.storageGet("enabled") === "true" && backgroundNotifications?.connected === true;
    if (!backgroundNotificationSession.accepts(event.message.timestamp, sessionActive)) return;
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
  }, () => backgroundNotificationSession.open(), () => console.warn("[decky-whatsapp] notification connection failed"), () => {
    backgroundNotificationSession.close();
  });
}

// Panel state, saved preferences, and synchronization effects.
function WhatsAppPanel() {
  // A Decky/plugin restart always requires an explicit user start.
  const [enabled, setEnabled] = useState(() => pluginConnectionSession.isEnabled());
  const [lastError, setLastError] = useState("");
  const [contactsState, setContactsState] = useState<ContactsState>("idle");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [uncertainDeliveryIds, setUncertainDeliveryIds] = useState<Set<string>>(() => new Set());
  const uncertainDeliveryIdsRef = useRef(uncertainDeliveryIds);
  const [ownReactions, setOwnReactions] = useState<Record<string, string | null>>({});
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [focusedMessageId, setFocusedMessageId] = useState("");
  const focusedMessageIdRef = useRef("");
  const messageYAction = useRef<(messageId: string) => boolean>(() => false);
  const messageYPress = useRef<(messageId: string) => boolean>(() => false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | undefined>();
  const [reply, setReply] = useState("");
  const replyInputActive = useRef(false);
  const [error, setError] = useState("");
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
  const [reactionEmoji, setReactionEmoji] = useState(() => {
    const saved = provider.storageGet("reaction-emoji");
    return reactionChoices.includes(saved as typeof reactionChoices[number]) ? saved as typeof reactionChoices[number] : "❤️";
  });
  const [contactMode, setContactMode] = useState<ContactMode>(() => {
    const saved = provider.storageGet("contact-mode");
    return saved === "alphabetical" || saved === "recent" || saved === "last5" || saved === "sinceSession" ? saved : "recent";
  });
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const conversationFocusRef = useRef<HTMLDivElement | null>(null);
  const replyFieldContainerRef = useRef<HTMLDivElement | null>(null);
  const panelMounted = useRef(true);
  focusedMessageIdRef.current = focusedMessageId;

  const reportError = (message: string) => {
    setError(message);
    setLastError(message);
  };

  const conversation = useConversationHistory({
    panelMounted,
    uncertainDeliveryIds: uncertainDeliveryIdsRef,
    compactHistory,
    setChats,
    setOwnReactions,
    setSelectedMessageId,
    setReplyTarget,
    setFocusedMessageId,
    setError,
    reportError
  });
  const {
    selectedChat, selectedChatId, selectedChatIdRef, pendingContactFocusId,
    history, setHistory, historyRefresh, setHistoryRefresh, historyLoading, setHistoryLoading,
    historyLimit, historyHasMore, historyAppliedVersion,
    historyExpansionPending, historyExpansionBoundary, historyExpansionFocus, scrollOnOpen,
    historyAppliedConversationRun, recentLiveMessages, conversationRun, historyRevision,
    bridgeSessionEstablished, invalidateSession, invalidateHistory,
    abortHistory, loadHistory, selectChat, loadMoreHistory, retryMediaLoad, markMediaUnavailable,
    closeConversation: closeHistoryConversation, clearForDisconnect
  } = conversation;
  const actions = useConversationActions({
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
    uncertainDeliveryIds: uncertainDeliveryIdsRef,
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
  });
  const { sending, messageActionId, setMessageActionId, sendReply, retryMessage, deleteMessage, reactToMessage } = actions;

  useEffect(() => {
    panelMounted.current = true;
    return () => {
      panelMounted.current = false;
      conversationRun.current += 1;
      abortHistory();
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


  const voiceTyping = useVoiceTyping({
    getVoiceStatus: provider.voiceStatus,
    transcribeAudio: provider.transcribe,
    panelMounted,
    conversationRun,
    onInsertReply: (text) => setReply((current) => current ? `${current} ${text}` : text),
    onError: reportError,
    onTransientStatus: setError
  });
  const { voiceState, voiceTypingAvailable } = voiceTyping;

  const reportConnectionWarning = (message: string) => {
    setLastError(message);
  };

  const resetMockScenario = () => {
    if (provider.variant !== "mock") return;
    disconnectLocally();
    invalidateHistory();
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

  const profileChatIds = JSON.stringify(visibleChats.map((chat) => chat.chatId).sort());
  const adoptBridgeSession = (sessionId: string) => {
    conversation.invalidateSession(sessionId);
  };
  const bridgeConnection = useBridgeConnection({
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
    subscribe: subscribeProvider,
    profileChatIds,
    showSettings,
    showDiagnostics,
    reportConnectionWarning
  });
  const {
    status, socketState, httpState, statusUpdatedAt, lastHealthCheckAt, bridgeSessionId, requestReconnect
  } = bridgeConnection;
  const activeConnectionWarning = getConnectionWarning(enabled, httpState, socketState, status);

  // The plugin-level Steam suspend callback invokes this only while enabled.
  useEffect(() => {
    if (!enabled) {
      reconnectMountedPanel = undefined;
      return;
    }
    const reconnect = () => requestReconnect();
    reconnectMountedPanel = reconnect;
    return () => {
      if (reconnectMountedPanel === reconnect) reconnectMountedPanel = undefined;
    };
  }, [enabled]);

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

  const reconnectFromDiagnostics = requestReconnect;

  const closeConversation = () => {
    replyInputActive.current = false;
    closeHistoryConversation();
    voiceTyping.resetVoice();
    setReply("");
    setError("");
  };

  const registerAudioRef = (messageId: string, element: HTMLAudioElement | null) => {
    audioRefs.current[messageId] = element;
  };

  const registerVideoRef = (messageId: string, element: HTMLVideoElement | null) => {
    videoRefs.current[messageId] = element;
  };

  const playAudio = (messageId: string) => {
    const audio = audioRefs.current[messageId];
    if (!audio) return;
    void audio.play().catch(() => {
      console.error("[decky-whatsapp] voice playback failed");
      toaster.toast({ title: "Voice message", body: "Decky could not play this audio", duration: 5000 });
    });
  };

  const renderMedia = (message: IncomingMessage) => <MessageMedia
    message={message}
    onRetryMediaLoad={retryMediaLoad}
    onMarkMediaUnavailable={markMediaUnavailable}
    registerAudioRef={registerAudioRef}
    registerVideoRef={registerVideoRef}
    onPlayAudio={playAudio}
  />;

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
    const player = action === "toggle-video" ? videoRefs.current[messageId] : audioRefs.current[messageId];
    if (!player) return false;
    if (player.paused) void player.play().catch(() => console.error(action === "toggle-video" ? "[decky-whatsapp] video playback failed" : "[decky-whatsapp] voice playback failed"));
    else player.pause();
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
        <ContactBrowser
          providerVariant={provider.variant}
          enabled={enabled}
          status={status}
          contactsState={contactsState}
          chatsCount={chats.length}
          visibleChats={visibleChats}
          activeConnectionWarning={activeConnectionWarning}
          mockSearchQuery={mockSearchQuery}
          onSimulateIncoming={() => provider.simulateIncoming()}
          onSimulateReaction={() => provider.simulateReaction()}
          onSwitchSession={() => provider.switchSession()}
          onSimulateError={() => provider.simulateError()}
          onSimulateReconnect={() => provider.simulateReconnect()}
          onSimulateSendFailure={() => provider.simulateSendFailure()}
          onSimulateMediaFailure={() => provider.simulateMediaFailure()}
          onSimulateDelay={(milliseconds) => provider.simulateDelay(milliseconds)}
          onResetMockScenario={resetMockScenario}
          onMockSearchChange={(value) => setMockSearchQuery(inputValue(value))}
          onRetry={requestReconnect}
          onSelectChat={(chat) => void selectChat(chat)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
      {!selectedChatId && showSettings && !showDiagnostics && (
        <SettingsPanel
          providerLabel={provider.label}
          notificationsEnabled={notificationsEnabled}
          notificationSoundEnabled={notificationSoundEnabled}
          notificationPreviewsEnabled={notificationPreviewsEnabled}
          notificationsWhileGaming={notificationsWhileGaming}
          reactionEmoji={reactionEmoji}
          contactMode={contactMode}
          compactHistory={compactHistory}
          onToggleNotifications={() => setNotificationsEnabled((current) => !current)}
          onToggleNotificationSound={() => setNotificationSoundEnabled((current) => !current)}
          onToggleNotificationPreviews={() => setNotificationPreviewsEnabled((current) => !current)}
          onToggleNotificationsWhileGaming={() => setNotificationsWhileGaming((current) => !current)}
          onSelectReaction={setReactionEmoji}
          onSelectContactMode={(mode) => { setContactMode(mode); setShowSettings(false); }}
          onToggleCompactHistory={() => setCompactHistory((current) => !current)}
          onOpenDiagnostics={() => setShowDiagnostics(true)}
          onBack={() => setShowSettings(false)}
        />
      )}
      {!selectedChatId && showDiagnostics && (
        <DiagnosticsPanel
          enabled={enabled}
          httpState={httpState}
          socketState={socketState}
          providerVariant={provider.variant}
          status={status}
          statusUpdatedAt={statusUpdatedAt}
          lastHealthCheckAt={lastHealthCheckAt}
          sessionId={bridgeSessionId}
          lastError={lastError}
          onReconnect={reconnectFromDiagnostics}
          onBack={() => { setShowDiagnostics(false); setShowSettings(true); }}
        />
      )}
      {selectedChatId && (
        <Focusable ref={conversationFocusRef} navEntryPreferPosition={NavEntryPositionPreferences.FIRST} onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          const messageElement = target.closest<HTMLElement>("[data-decky-message-id]");
          setFocusedMessageId(messageElement?.dataset.deckyMessageId || "");
        }} onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeConversation();
        }}>
        <PanelSection title="Conversation">
          <ConversationMessages
            selectedChat={selectedChat}
            historyLength={history.length}
            historyLoading={historyLoading}
            historyExpansionPending={historyExpansionPending.current}
            compactHistory={compactHistory}
            nextHistoryLimit={nextHistoryLimit}
            historyHasMore={historyHasMore}
            historyLimit={historyLimit}
            displayedHistory={displayedHistory}
            selectedMessageId={selectedMessageId}
            onCloseConversation={closeConversation}
            onLoadMore={() => { void loadMoreHistory(); }}
            onFocusMessage={setFocusedMessageId}
            onSelectMessage={setSelectedMessageId}
            onMessageYPress={(messageId) => messageYPress.current(messageId)}
            renderMedia={renderMedia}
          />
          <SelectedMessageActions
            selectedMessage={selectedMessage}
            providerVariant={provider.variant}
            reactionEmoji={reactionEmoji}
            canRetry={Boolean(selectedMessage && selectedMessage.fromMe && !selectedMessage.viewOnce && selectedMessage.ack === -1 && !selectedMessage.deliveryUncertain && !uncertainDeliveryIds.has(selectedMessage.id))}
            canDelete={Boolean(selectedMessage && selectedMessage.fromMe && !selectedMessage.deliveryUncertain && !uncertainDeliveryIds.has(selectedMessage.id) && !selectedMessage.id.startsWith("local-failed-") && !selectedMessage.body.startsWith("[Message deleted]"))}
            retryDisabled={messageActionId === selectedMessage?.id}
            deleteDisabled={messageActionId === selectedMessage?.id}
            editingMockMessage={Boolean(editingMockMessageId)}
            editingMockMessageBody={editingMockMessageBody}
            onReply={() => selectedMessage && setReplyTarget({ id: selectedMessage.id, sender: selectedMessage.fromMe ? "You" : selectedMessage.sender, body: selectedMessage.body })}
            onReact={() => { if (!selectedMessage) return; const current = ownReactions[selectedMessage.id] ?? selectedMessage.reaction ?? ""; void reactToMessage(selectedMessage.chatId, selectedMessage.id, current === reactionEmoji ? "" : reactionEmoji); }}
            onRetry={() => { if (selectedMessage) void retryMessage(selectedMessage); }}
            onDelete={() => { if (selectedMessage) void deleteMessage(selectedMessage); }}
            onBeginMockEdit={() => { if (!selectedMessage) return; setEditingMockMessageId(selectedMessage.id); setEditingMockMessageBody(selectedMessage.body); }}
            onMockMessageBodyChange={(value) => setEditingMockMessageBody(inputValue(value))}
            onSaveMockEdit={async () => { const ok = await provider.editMockMessage(selectedChatId, editingMockMessageId, editingMockMessageBody); if (ok) setHistory((current) => current.map((message) => message.id === editingMockMessageId ? { ...message, body: editingMockMessageBody } : message)); setEditingMockMessageId(""); }}
            onCancelMockEdit={() => setEditingMockMessageId("")}
          />
          <ReplyComposer
            containerRef={replyFieldContainerRef}
            replyTarget={replyTarget}
            reply={reply}
            sending={sending}
            voiceEnabled={provider.voiceEnabled}
            voiceTypingAvailable={voiceTypingAvailable}
            voiceState={voiceState}
            onCancelReply={() => setReplyTarget(undefined)}
            onReplyFocus={() => { replyInputActive.current = true; }}
            onReplyBlur={() => { replyInputActive.current = false; }}
            onReplyChange={(value) => setReply(inputValue(value))}
            onSend={() => void sendReply()}
            onVoiceTyping={voiceTyping.startVoiceTyping}
          />
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
