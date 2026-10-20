// Test WhatsAppService behavior with mocked clients and messages; no real account is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import qrcodeTerminal from "qrcode-terminal";
import { getChromiumSandboxArgs, isViewOnceMessage, WhatsAppService } from "./whatsapp.js";

const require = createRequire(import.meta.url);
const Message = require("whatsapp-web.js/src/structures/Message.js");

test("Chromium sandbox overrides are limited to Linux", () => {
  assert.deepEqual(getChromiumSandboxArgs("linux"), ["--no-sandbox", "--disable-setuid-sandbox"]);
  assert.deepEqual(getChromiumSandboxArgs("win32"), []);
});

test("background QR pairing keeps the plugin QR event but suppresses terminal credentials", async () => {
  const previousMode = process.env.DECKY_WHATSAPP_BACKGROUND;
  const originalGenerate = qrcodeTerminal.generate;
  let terminalQrCalls = 0;
  const service = new WhatsAppService();
  const qrEvent = new Promise<unknown>((resolve) => service.onEvent((event) => {
    if (event.type === "qr") resolve(event);
  }));
  const client = (service as unknown as { client: { emit: (event: string, value: string) => void } }).client;
  try {
    process.env.DECKY_WHATSAPP_BACKGROUND = "1";
    qrcodeTerminal.generate = (() => { terminalQrCalls += 1; }) as typeof qrcodeTerminal.generate;
    client.emit("qr", "test-pairing-data");
    const event = await qrEvent as { type: string; dataUrl?: string };
    await setImmediate();
    assert.equal(terminalQrCalls, 0);
    assert.equal(event.type, "qr");
    assert.match(event.dataUrl ?? "", /^data:image\/png;base64,/);
  } finally {
    qrcodeTerminal.generate = originalGenerate;
    if (previousMode === undefined) delete process.env.DECKY_WHATSAPP_BACKGROUND;
    else process.env.DECKY_WHATSAPP_BACKGROUND = previousMode;
  }
});

test("reaction bridge events include safe actor, parent, timestamp, and reaction identity fields", () => {
  const service = new WhatsAppService();
  const events: import("./types.js").BridgeEvent[] = [];
  service.onEvent((event) => events.push(event));
  const client = (service as unknown as { client: { info?: unknown; emit: (name: string, value: unknown) => void } }).client;
  client.info = { wid: { _serialized: "self@example" } };
  client.emit("message_reaction", {
    id: { remote: "group@example", id: "reaction-1", fromMe: false },
    msgId: { remote: "group@example", id: "own-message-1", fromMe: true },
    timestamp: 1_797_000_000,
    reaction: "🌱",
    senderId: "other@example"
  });

  assert.deepEqual(events, [{
    type: "reaction",
    chatId: "group@example",
    messageId: "group@example_own-message-1",
    emoji: "🌱",
    fromMe: false,
    reactionId: "group@example_reaction-1",
    actorId: "other@example",
    actorIsMe: false,
    parentFromMe: true,
    timestamp: 1_797_000_000
  }]);
});

test("reaction bridge events recover attribution from WhatsApp's renamed $1 message keys", () => {
  const service = new WhatsAppService();
  const events: import("./types.js").BridgeEvent[] = [];
  service.onEvent((event) => events.push(event));
  const client = (service as unknown as { client: { info?: unknown; emit: (name: string, value: unknown) => void } }).client;
  client.info = { wid: { $1: "self@example" } };
  client.emit("message_reaction", {
    id: { $1: "false_group@example_reaction-2" },
    msgId: { $1: "true_group@example_own-message-2" },
    timestamp: 1_797_000_001,
    reaction: "👍"
  });

  assert.deepEqual(events, [{
    type: "reaction",
    chatId: "group@example",
    messageId: "true_group@example_own-message-2",
    emoji: "👍",
    fromMe: false,
    reactionId: "false_group@example_reaction-2",
    actorIsMe: false,
    parentFromMe: true,
    timestamp: 1_797_000_001
  }]);
});

function createService() {
  const service = Object.create(WhatsAppService.prototype) as any;
  service.mediaCache = new Map();
  service.mediaRequests = new Map();
  service.mediaCacheBytes = 0;
  service.reactionCache = new Map();
  service.listeners = new Set();
  service.recentMessages = [];
  service.contactNameCache = new Map();
  service.receivedChatIdsSinceSession = new Set();
  service.reconnectAttempt = 0;
  service.reconnecting = false;
  service.stopping = false;
  return service;
}

test("delete passes a WhatsApp message ID that only has $1", async () => {
  const id = { $1: "true_chat-1_message-1", remote: "chat-1", fromMe: true };
  let passedId: unknown;
  const message = new Message({
    pupPage: { evaluate: async (_callback: unknown, targetId: unknown) => { passedId = targetId; } }
  }, { id });

  await message.delete(true);
  assert.deepEqual(passedId, id);
});

test("a failed WhatsApp reconnect schedules another attempt", async () => {
  const service = Object.create(WhatsAppService.prototype) as any;
  service.client = {
    destroy: async () => undefined,
    initialize: async () => { throw new Error("temporary startup failure"); }
  };
  service.listeners = new Set();
  service.reconnectAttempt = 0;
  service.reconnecting = false;
  service.stopping = false;

  try {
    await service.reconnect();
    assert.equal(service.status, "disconnected");
    assert.equal(service.reconnecting, false);
    assert.ok(service.reconnectTimer, "a second attempt should be scheduled");
  } finally {
    if (service.reconnectTimer) clearTimeout(service.reconnectTimer);
  }
});

test("delete for everyone refuses a message WhatsApp can only delete locally", async () => {
  const service = Object.create(WhatsAppService.prototype) as any;
  let deleteCalled = false;
  service.status = "ready";
  service.client = {
    getChatById: async () => ({
      fetchMessages: async () => [{
        id: { _serialized: "message-1" },
        fromMe: true,
        delete: async () => { deleteCalled = true; }
      }]
    }),
    pupPage: { evaluate: async () => false }
  };

  await assert.rejects(
    service.deleteMessage("chat-1", "message-1"),
    /no longer permits deleting this message for everyone/
  );
  assert.equal(deleteCalled, false);
});

test("delete for everyone proceeds when WhatsApp permits revocation", async () => {
  const service = createService();
  let deleteForEveryone: boolean | undefined;
  service.status = "ready";
  service.client = {
    getChatById: async () => ({
      fetchMessages: async () => [{
        id: { _serialized: "message-2" },
        fromMe: true,
        delete: async (everyone: boolean) => { deleteForEveryone = everyone; }
      }]
    }),
    pupPage: { evaluate: async () => true }
  };

  await service.deleteMessage("chat-1", "message-2");
  assert.equal(deleteForEveryone, true);
});

test("concurrent history reads share one media download and reuse it", async () => {
  const service = createService();
  let downloads = 0;
  let finish!: (media: unknown) => void;
  service.downloadMedia = () => { downloads++; return new Promise((resolve) => { finish = resolve; }); };
  const message = { id: "media-1", hasMedia: true, type: "sticker" };
  const first = service.getMedia(message);
  const second = service.getMedia(message);
  assert.equal(downloads, 1);
  const media = { dataUrl: "data:image/webp;base64,AA==", kind: "sticker", mimetype: "image/webp" };
  finish(media);
  assert.deepEqual(await first, media);
  assert.deepEqual(await second, media);
  assert.deepEqual(await service.getMedia(message), media);
  assert.equal(downloads, 1);
});

test("deleted media cannot be restored by an in-flight download", async () => {
  const service = createService();
  let finish!: (media: unknown) => void;
  service.downloadMedia = () => new Promise((resolve) => { finish = resolve; });
  const pending = service.getMedia({ id: "deleted-media", hasMedia: true, type: "image" });
  service.forgetMedia("deleted-media");
  finish({ dataUrl: "data:image/jpeg;base64,AA==" });
  assert.equal(await pending, undefined);
  assert.equal(service.mediaCache.size, 0);
});

test("unavailable media can be retried, and the successful cache is bounded", async () => {
  const service = createService();
  let downloads = 0;
  service.downloadMedia = async () => ++downloads === 1 ? undefined : { dataUrl: "data:image/jpeg;base64,AA==", kind: "image", mimetype: "image/jpeg" };
  const message = { id: "media-0", hasMedia: true, type: "image" };
  assert.equal(await service.getMedia(message), undefined);
  assert.ok(await service.getMedia(message));
  for (let index = 1; index <= 50; index++) await service.getMedia({ ...message, id: `media-${index}` });
  assert.equal(service.mediaCache.size, 50);
  assert.equal(service.mediaCache.has("media-0"), false);
});

test("view-once history is marked and never attempts a media download", async () => {
  const service = createService();
  let downloads = 0;
  service.status = "ready";
  service.downloadMedia = async () => {
    downloads++;
    return { dataUrl: "data:image/jpeg;base64,AA==", kind: "image", mimetype: "image/jpeg" };
  };
  service.getSenderName = async () => "Contact";
  const viewOnceMessage = {
    id: "view-once-history",
    from: "chat-1",
    fromMe: false,
    timestamp: 100,
    body: "",
    type: "image",
    hasMedia: true,
    _data: { isViewOnceV2: true }
  };
  service.client = {
    getChatById: async () => ({
      id: { _serialized: "chat-1" },
      name: "Chat",
      fetchMessages: async () => [viewOnceMessage]
    })
  };

  const history = await service.getChatHistory("chat-1");
  assert.equal(downloads, 0);
  assert.equal(history.messages[0].viewOnce, true);
  assert.equal(history.messages[0].body, "[View-once media]");
  assert.equal(history.messages[0].media, undefined);
});

test("ordinary incoming videos get a useful fallback and hydrate through history", async () => {
  const service = createService();
  service.getSenderName = async () => "Contact";
  const message = {
    id: "ordinary-video",
    from: "chat-1",
    fromMe: false,
    timestamp: 120,
    body: "",
    type: "video",
    hasMedia: true,
    getChat: async () => ({ id: { _serialized: "chat-1" }, name: "Chat" }),
    downloadMedia: async () => ({ mimetype: "video/mp4; codecs=avc1", data: "AA==", filename: "clip.mp4" })
  };
  let event: any;
  service.onEvent((next: unknown) => { event = next; });
  await service.publishCreatedMessage(message);
  assert.equal(event.message.body, "[Video]");
  assert.equal(event.message.mediaKind, "video");

  service.status = "ready";
  service.client = { getChatById: async () => ({
    id: { _serialized: "chat-1" }, name: "Chat", fetchMessages: async () => [message]
  }) };
  const history = await service.getChatHistory("chat-1");
  assert.equal(history.messages[0].body, "[Video]");
  assert.equal(history.messages[0].mediaKind, "video");
  assert.deepEqual(history.messages[0].media, {
    dataUrl: "data:video/mp4;base64,AA==", filename: "clip.mp4", kind: "video", mimetype: "video/mp4"
  });
});

test("ordinary video downloads accept browser-supported MIME types and reject unsupported or oversized payloads", async () => {
  const service = createService();
  const makeVideo = (mimetype: string, data = "AA==") => ({
    id: "video", from: "chat-1", fromMe: false, timestamp: 1, type: "video", hasMedia: true,
    downloadMedia: async () => ({ mimetype, data })
  });
  const mp4 = await service.downloadMedia(makeVideo("VIDEO/MP4; codecs=avc1") as any);
  const webm = await service.downloadMedia(makeVideo("video/webm") as any);
  const imageMime = await service.downloadMedia(makeVideo("image/jpeg") as any);
  const audioMime = await service.downloadMedia(makeVideo("audio/ogg") as any);
  assert.equal(mp4?.kind, "video");
  assert.equal(mp4?.mimetype, "video/mp4");
  assert.equal(mp4?.dataUrl, "data:video/mp4;base64,AA==");
  assert.equal(webm?.mimetype, "video/webm");
  assert.equal(imageMime, undefined, "video messages must reject an image MIME payload");
  assert.equal(audioMime, undefined, "video messages must reject an audio MIME payload");
  assert.equal(await service.downloadMedia(makeVideo("video/quicktime") as any), undefined);
  assert.equal(await service.downloadMedia(makeVideo("video/mp4", "A".repeat(12_000_001)) as any), undefined);

  const gifMarkedVideo = await service.downloadMedia({
    ...makeVideo("video/webm"), isGif: true
  } as any);
  assert.equal(gifMarkedVideo?.kind, "gif", "WhatsApp video messages marked as GIF retain GIF classification");
});

test("view-once videos keep the phone fallback and are never downloaded or classified for playback", async () => {
  const service = createService();
  let downloads = 0;
  service.status = "ready";
  service.getSenderName = async () => "Contact";
  const viewOnceVideo = {
    id: "view-once-video", from: "chat-1", fromMe: false, timestamp: 100, body: "", type: "video", hasMedia: true,
    _data: { isViewOnceV2: true }, downloadMedia: async () => { downloads++; return { mimetype: "video/mp4", data: "AA==" }; }
  };
  service.client = { getChatById: async () => ({
    id: { _serialized: "chat-1" }, name: "Chat", fetchMessages: async () => [viewOnceVideo]
  }) };

  const history = await service.getChatHistory("chat-1");
  assert.equal(downloads, 0);
  assert.equal(history.messages[0].viewOnce, true);
  assert.equal(history.messages[0].body, "[View-once media]");
  assert.equal(history.messages[0].mediaKind, undefined);
  assert.equal(history.messages[0].media, undefined);
});

test("live view-once events preserve captions and carry the capability flag", async () => {
  const service = createService();
  service.getSenderName = async () => "Contact";
  let event: any;
  service.onEvent((next: unknown) => { event = next; });
  await service.publishCreatedMessage({
    id: "view-once-live",
    from: "chat-1",
    fromMe: false,
    timestamp: 100,
    body: "A private caption",
    type: "image",
    hasMedia: true,
    isViewOnce: true,
    getChat: async () => ({ id: { _serialized: "chat-1" }, name: "Chat" })
  });

  assert.equal(event.type, "message");
  assert.equal(event.message.viewOnce, true);
  assert.equal(event.message.body, "A private caption");
  assert.equal(event.message.media, undefined);
});

test("view-once runtime flags are recognized on the message and raw data", () => {
  assert.equal(isViewOnceMessage({ isViewOnce: true }), true);
  assert.equal(isViewOnceMessage({ isViewOnceV2: true }), true);
  assert.equal(isViewOnceMessage({ _data: { isViewOnce: true } }), true);
  assert.equal(isViewOnceMessage({ _data: { isViewOnceV2: true } }), true);
  assert.equal(isViewOnceMessage({ _data: { isViewOnce: false } }), false);
});

test("initial startup failure leaves a retryable disconnected state", async () => {
  const service = createService();
  service.client = { initialize: async () => { throw new Error("startup offline"); } };
  try {
    await assert.rejects(service.start(), /startup offline/);
    assert.equal(service.getStatus(), "disconnected");
    assert.ok(service.reconnectTimer);
  } finally { clearTimeout(service.reconnectTimer); }
});

test("a disconnect during initialization still schedules the next reconnect", async () => {
  const service = createService();
  service.client = {
    destroy: async () => {},
    initialize: async () => { service.status = "disconnected"; service.scheduleReconnect(); }
  };
  try {
    await service.reconnect();
    assert.ok(service.reconnectTimer);
  } finally { clearTimeout(service.reconnectTimer); }
});

test("stop during reconnect cleanup cannot start a new browser", async () => {
  const service = createService();
  let finish!: () => void;
  let initialized = false;
  let destroys = 0;
  service.client = {
    destroy: () => ++destroys === 1 ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve(),
    initialize: async () => { initialized = true; }
  };
  const reconnecting = service.reconnect();
  await service.stop();
  finish();
  await reconnecting;
  assert.equal(initialized, false);
  assert.equal(service.reconnectTimer, undefined);
});

test("history bounds concurrent work, preserves captions/order and sends image data once", async () => {
  const service = createService();
  service.status = "ready";
  const messages = Array.from({ length: 12 }, (_, index) => ({
    id: `image-${index}`, body: `caption ${index}`, type: "image", fromMe: true, timestamp: index
  }));
  service.client = { getChatById: async () => ({ id: { _serialized: "chat" }, fetchMessages: async () => messages }) };
  let active = 0;
  let maximum = 0;
  service.getMedia = async () => {
    maximum = Math.max(maximum, ++active);
    await setImmediate();
    active--;
    return { dataUrl: "data:image/jpeg;base64,AA==", kind: "image", mimetype: "image/jpeg" };
  };
  const result = await service.getChatHistory("chat", 12);
  assert.equal(maximum, 4);
  assert.deepEqual(result.messages.map((message: any) => message.body), messages.map((message) => message.body));
  assert.ok(result.messages.every((message: any) => message.media && !message.image));
});

test("history sorts unordered WhatsApp results chronologically before selecting the latest window", async () => {
  const service = createService();
  service.status = "ready";
  const messages = [
    { id: "later", body: "later", fromMe: true, timestamp: 30 },
    { id: "oldest", body: "oldest", fromMe: true, timestamp: 10 },
    { id: "middle", body: "middle", fromMe: true, timestamp: 20 },
    { id: "newest", body: "newest", fromMe: true, timestamp: 40 }
  ];
  service.client = { getChatById: async () => ({
    id: { _serialized: "chat" },
    fetchMessages: async () => messages
  }) };

  const result = await service.getChatHistory("chat", 2);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.messages.map((message: any) => message.id), ["later", "newest"]);
});

test("history preserves fetched order for sent and received messages in the same second", async () => {
  const service = createService();
  service.status = "ready";
  const messages = [
    { id: "earlier", body: "earlier", fromMe: true, timestamp: 99 },
    { id: "true_chat_ZZZ", body: "sent", fromMe: true, timestamp: 100 },
    { id: "false_chat_AAA", body: "reply", fromMe: false, timestamp: 100, from: "contact", getContact: async () => ({ name: "Contact" }) }
  ];
  service.client = { getChatById: async () => ({
    id: { _serialized: "chat" },
    fetchMessages: async () => messages
  }) };

  const result = await service.getChatHistory("chat", 2);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.messages.map((message: any) => message.id), ["true_chat_ZZZ", "false_chat_AAA"]);
});

test("recent chats are sorted newest first with deterministic ties", async () => {
  const service = createService();
  service.status = "ready";
  service.client = { getChats: async () => [
    { id: { _serialized: "chat-z", user: "z" }, lastMessage: { timestamp: 20, body: "z" } },
    { id: { _serialized: "chat-new", user: "new" }, lastMessage: { timestamp: 30, body: "new" } },
    { id: { _serialized: "chat-b", user: "b" }, lastMessage: { timestamp: 20, body: "b" } },
    { id: { _serialized: "chat-empty", user: "empty" } }
  ] };

  const result = await service.getRecentChats();
  assert.deepEqual(result.chats.map((chat: any) => chat.chatId), ["chat-new", "chat-b", "chat-z", "chat-empty"]);
});

test("fresh reaction lookup clears a reaction removed on another device", async () => {
  const service = createService();
  service.status = "ready";
  service.reactionCache.set("message", "❤️");
  service.client = {
    getChatById: async () => ({ id: { _serialized: "chat" }, fetchMessages: async () => [{ id: "message", body: "hello", fromMe: true }] }),
    pupPage: { evaluate: async () => [] }
  };
  const result = await service.getChatHistory("chat");
  assert.equal(result.messages[0].reaction, undefined);
  assert.equal(service.reactionCache.has("message"), false);
});

test("media download failures do not log exception messages, URLs, or tokens", async () => {
  const service = createService();
  const sentinel = "PRIVATE_SENTINEL https://example.invalid/media?token=secret-value";
  const originalError = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => { captured.push(args); };
  try {
    const result = await service.downloadMedia({
      id: "media-1",
      from: "chat-1",
      fromMe: false,
      timestamp: 1,
      type: "image",
      hasMedia: true,
      downloadMedia: async () => { throw new Error(sentinel); }
    });
    assert.equal(result, undefined);
  } finally {
    console.error = originalError;
  }
  assert.ok(captured.length > 0, "the failure should retain a fixed diagnostic");
  assert.ok(!JSON.stringify(captured).includes(sentinel));
  assert.ok(!JSON.stringify(captured).includes("secret-value"));
});

test("chat service failures retain fallback behavior without logging exception content", async () => {
  const service = createService();
  const sentinel = "PRIVATE_SENTINEL https://example.invalid/api?token=secret-value";
  service.status = "ready";
  service.recentMessages = [];
  service.client = { getChats: async () => { throw new Error(sentinel); } };
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const captured: unknown[][] = [];
  console.log = (...args: unknown[]) => { captured.push(args); };
  console.warn = (...args: unknown[]) => { captured.push(args); };
  console.error = (...args: unknown[]) => { captured.push(args); };
  try {
    assert.deepEqual(await service.getRecentChats(), { chats: [], hasMore: false });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.ok(captured.some((args) => args.includes("[chats] unable to load recent WhatsApp chats")));
  assert.ok(!JSON.stringify(captured).includes(sentinel));
  assert.ok(!JSON.stringify(captured).includes("secret-value"));
});
