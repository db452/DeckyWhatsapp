import type { ChatSummary } from "./types/chat";
import type { IncomingMessage } from "./types/message";
import type { BridgeEvent, DataProvider, Operation, OperationPayload, ProviderConnection, ProviderResponse } from "./provider";

const storagePrefix = "decky-whatsapp-mock-";
const baseTime = 1_797_000_000;
const sessionIds = ["mock-session-alpha", "mock-session-beta"];
const chats: ChatSummary[] = [
  { chatId: "mock-contact-ava", chatName: "Ava Example", lastMessage: "The blue mock image looks great.", timestamp: baseTime, unreadCount: 2, receivedSinceSession: true },
  { chatId: "mock-group-garden", chatName: "Garden Club (mock group)", lastMessage: "I will bring the seed tray.", timestamp: baseTime - 40, unreadCount: 1, receivedSinceSession: true },
  { chatId: "mock-contact-milo", chatName: "Milo Sample", lastMessage: "Voice note placeholder", timestamp: baseTime - 240, unreadCount: 0, receivedSinceSession: false },
  { chatId: "mock-session-beta-contact", chatName: "Second Session — Nia", lastMessage: "Hello from session beta.", timestamp: baseTime - 500, unreadCount: 0, receivedSinceSession: true },
  { chatId: "mock-empty-conversation", chatName: "Empty Example", lastMessage: "No messages yet", timestamp: baseTime - 900, unreadCount: 0, receivedSinceSession: false }
];
const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#276b91"/><text x="12" y="55" fill="white" font-size="16">MOCK IMAGE</text></svg>');
const histories = new Map<string, IncomingMessage[]>([
  ["mock-contact-ava", [
    msg("mock-ava-1", "mock-contact-ava", "Ava Example", "Did you see the mock album?", baseTime - 180, false),
    { ...msg("mock-ava-2", "mock-contact-ava", "You", "Yes, this is a fabricated image.", baseTime - 120, true), mediaKind: "image", image: { dataUrl: image, filename: "mock-blue.png" }, media: { dataUrl: image, filename: "mock-blue.png", kind: "image", mimetype: "image/svg+xml" } },
    msg("mock-ava-3", "mock-contact-ava", "Ava Example", "The blue mock image looks great.", baseTime, false)
  ]],
  ["mock-group-garden", [
    msg("mock-garden-1", "mock-group-garden", "Milo Sample", "The seedlings are ready.", baseTime - 280, false),
    msg("mock-garden-2", "mock-group-garden", "You", "I will bring the mock pots.", baseTime - 150, true),
    msg("mock-garden-3", "mock-group-garden", "Nia Example", "Saturday at ten?", baseTime - 90, false),
    msg("mock-garden-4", "mock-group-garden", "Milo Sample", "I can bring the blue pots.", baseTime - 80, false),
    msg("mock-garden-5", "mock-group-garden", "You", "I have the labels ready.", baseTime - 70, true),
    msg("mock-garden-6", "mock-group-garden", "Nia Example", "The mock map is pinned.", baseTime - 60, false),
    msg("mock-garden-7", "mock-group-garden", "Milo Sample", "Thanks, see you there.", baseTime - 50, false),
    msg("mock-garden-8", "mock-group-garden", "Nia Example", "I will bring the seed tray.", baseTime - 40, false)
  ]],
  ["mock-contact-milo", [
    msg("mock-milo-1", "mock-contact-milo", "Milo Sample", "Here is an audio placeholder.", baseTime - 400, false),
    { ...msg("mock-milo-2", "mock-contact-milo", "Milo Sample", "Voice note placeholder", baseTime - 240, false), mediaKind: "audio" }
  ]],
  ["mock-session-beta-contact", [
    msg("mock-beta-1", "mock-session-beta-contact", "Nia Example", "Hello from session beta.", baseTime - 500, false),
    { ...msg("mock-beta-view-photo", "mock-session-beta-contact", "Nia Example", "Fabricated view-once photo placeholder.", baseTime - 480, false), mediaKind: "image", viewOnce: true },
    { ...msg("mock-beta-view-video", "mock-session-beta-contact", "Nia Example", "Fabricated view-once video placeholder.", baseTime - 460, false), viewOnce: true },
    { ...msg("mock-beta-view-audio", "mock-session-beta-contact", "Nia Example", "Fabricated view-once audio placeholder.", baseTime - 440, false), mediaKind: "audio", viewOnce: true }
  ]],
  ["mock-empty-conversation", []]
]);
const initialChats = chats.map((chat) => ({ ...chat }));
const initialHistories = new Map([...histories].map(([id, messages]) => [id, messages.map((message) => ({ ...message }))]));

function msg(id: string, chatId: string, sender: string, body: string, timestamp: number, fromMe: boolean): IncomingMessage {
  const chat = chats.find((item) => item.chatId === chatId)!;
  return { id, chatId, chatName: chat.chatName, sender, body, timestamp, fromMe, ack: fromMe ? 3 : undefined };
}

let subscribers = new Set<(event: BridgeEvent) => void>();
let failNextRequest = false;
let failNextSend = false;
let unavailable = false;
let nextDelayMs = 0;
let failMediaMessageId = "";
let nextId = 1;
let activeSession = 0;
let resetEpoch = 0;
function emit(event: BridgeEvent): void { for (const listener of [...subscribers]) listener(event); }
function refreshChatPreview(chatId: string): void {
  const chat = chats.find((item) => item.chatId === chatId);
  if (!chat) return;
  const history = histories.get(chatId) || [];
  const latest = history[history.length - 1];
  chat.lastMessage = latest?.body || "No recent message";
  chat.timestamp = latest?.timestamp ?? initialChats.find((item) => item.chatId === chatId)?.timestamp ?? baseTime;
}
function response(data: unknown, status = 200): ProviderResponse {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}
function resultError(message: string, status = 503): ProviderResponse { return response({ error: message }, status); }

export const provider: DataProvider = {
  variant: "mock", pluginName: "Decky WhatsApp MOCK", label: "MOCK / OFFLINE", voiceEnabled: false,
  configure() { /* There is deliberately no address or configuration fallback. */ },
  async request(operation: Operation, payload: OperationPayload = {}, signal): Promise<ProviderResponse> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const delayMs = nextDelayMs;
    nextDelayMs = 0;
    if (delayMs > 0) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, delayMs);
      function done() { signal?.removeEventListener("abort", abort); resolve(); }
      function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); }
      signal?.addEventListener("abort", abort, { once: true });
    });
    if (unavailable) return resultError("Mock bridge is unavailable");
    if (failNextRequest) { failNextRequest = false; return resultError("Simulated mock provider failure"); }
    const chat = chats.find((item) => item.chatId === payload.chatId);
    switch (operation) {
      case "chats": return response({ chats: chats.map((item) => ({ ...item })) });
      case "health": return response({ status: "ready", sessionId: sessionIds[activeSession] });
      case "profile": return response({ profilePicUrl: null });
      case "history": {
        const all = histories.get(payload.chatId || "") || [];
        const limit = Math.max(1, Math.floor(payload.limit || 50));
        const selected = all.slice(-limit).map((item) => ({ ...item }));
        if (failMediaMessageId && selected.some((item) => item.id === failMediaMessageId)) {
          const failedId = failMediaMessageId;
          failMediaMessageId = "";
          return response({ messages: selected.map((item) => item.id === failedId
            ? { ...item, media: undefined, image: undefined, mediaLoadState: "unavailable" as const }
            : item), hasMore: all.length > limit });
        }
        return response({ messages: selected, hasMore: all.length > limit });
      }
      case "read": if (chat) chat.unreadCount = 0; return response({ marked: true });
      case "send": {
        if (failNextSend) { failNextSend = false; return resultError("Simulated mock send failure"); }
        if (!chat || !payload.body?.trim()) return resultError("Invalid mock message", 400);
        const message = { ...msg(`mock-out-${resetEpoch}-${nextId++}`, chat.chatId, "You", payload.body, baseTime + nextId, true), quotedMessageId: payload.quotedMessageId, ack: 3 };
        const list = histories.get(chat.chatId) || [];
        list.push(message); histories.set(chat.chatId, list); chat.lastMessage = message.body; chat.timestamp = message.timestamp;
        emit({ type: "message", message });
        return response({ accepted: true, messageId: message.id });
      }
      case "delete": {
        const message = (histories.get(payload.chatId || "") || []).find((item) => item.id === payload.messageId);
        if (!message) return resultError("Mock message not found", 404);
        message.body = "[Message deleted]"; message.media = undefined; message.image = undefined; message.mediaKind = undefined;
        refreshChatPreview(message.chatId);
        emit({ type: "message_update", update: "deleted", message }); return response({ deleted: true });
      }
      case "react": {
        const message = (histories.get(payload.chatId || "") || []).find((item) => item.id === payload.messageId);
        if (!message) return resultError("Mock message not found", 404);
        message.reaction = payload.emoji || undefined; message.reactions = payload.emoji ? [payload.emoji] : [];
        emit({ type: "reaction", chatId: message.chatId, messageId: message.id, emoji: payload.emoji || "", fromMe: true });
        return response({ reacted: true });
      }
      default: return resultError("Unsupported mock operation", 400);
    }
  },
  searchContacts(query) {
    const term = query.trim().toLocaleLowerCase();
    return chats.filter((chat) => !term || `${chat.chatName} ${chat.lastMessage}`.toLocaleLowerCase().includes(term));
  },
  subscribe(onEvent, onOpen, onError, onClose): ProviderConnection {
    let connected = true;
    const listener = (event: BridgeEvent) => onEvent(event);
    subscribers.add(listener);
    queueMicrotask(() => { if (connected) { onOpen(); listener({ type: "status", status: "ready", sessionId: sessionIds[activeSession] }); } });
    return { get connected() { return connected; }, close() { if (!connected) return; connected = false; subscribers.delete(listener); onClose(); },
    };
  },
  storageGet(key) { return window.localStorage.getItem(`${storagePrefix}${key}`); },
  storageSet(key, value) { window.localStorage.setItem(`${storagePrefix}${key}`, value); },
  async voiceStatus() { return { available: false, reason: "mock_unavailable" }; },
  async transcribe() { return "__VOICE_ERROR__not_configured"; },
  async editMockMessage(chatId, messageId, body) {
    const message = (histories.get(chatId) || []).find((item) => item.id === messageId);
    if (!message || !message.fromMe || !body.trim()) return false;
    message.body = body; refreshChatPreview(chatId); emit({ type: "message_update", update: "edited", message }); return true;
  },
  simulateIncoming() {
    const chat = chats[1]!;
    const message = msg(`mock-in-${resetEpoch}-${nextId++}`, chat.chatId, "Nia Example", `Deterministic incoming mock ${nextId}.`, baseTime + nextId, false);
    histories.get(chat.chatId)!.push(message); chat.lastMessage = message.body; chat.timestamp = message.timestamp; chat.unreadCount += 1;
    emit({ type: "message", message });
  },
  switchSession() {
    activeSession = (activeSession + 1) % sessionIds.length;
    emit({ type: "status", status: "ready", sessionId: sessionIds[activeSession] });
  },
  simulateDelay(milliseconds) { nextDelayMs = Math.max(0, Math.min(10_000, milliseconds)); },
  simulateSendFailure() { failNextSend = true; },
  simulateMediaFailure(messageId = "mock-ava-2") { failMediaMessageId = messageId; },
  simulateReconnect() { unavailable = false; for (const listener of [...subscribers]) listener({ type: "status", status: "ready", sessionId: sessionIds[activeSession] }); },
  simulateError() { unavailable = true; for (const listener of [...subscribers]) listener({ type: "status", status: "disconnected" }); },
  reset() {
    failNextRequest = false; failNextSend = false; unavailable = false; nextDelayMs = 0; failMediaMessageId = ""; nextId = 1; activeSession = 0; resetEpoch += 1;
    chats.splice(0, chats.length, ...initialChats.map((chat) => ({ ...chat })));
    histories.clear();
    for (const [id, messages] of initialHistories) histories.set(id, messages.map((message) => ({ ...message })));
    if (typeof window !== "undefined") window.localStorage.setItem(`${storagePrefix}enabled`, "false");
  }
};
