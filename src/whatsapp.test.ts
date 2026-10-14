import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { WhatsAppService } from "./whatsapp.js";

const require = createRequire(import.meta.url);
const Message = require("whatsapp-web.js/src/structures/Message.js");

function createService() {
  const service = Object.create(WhatsAppService.prototype) as any;
  service.mediaCache = new Map();
  service.mediaRequests = new Map();
  service.mediaCacheBytes = 0;
  service.reactionCache = new Map();
  service.listeners = new Set();
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
