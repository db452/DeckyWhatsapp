// Adapts whatsapp-web.js with LocalAuth, message enrichment, and reconnect recovery.
import qrcode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import type { BridgeEvent, BridgeStatus, ChatSummary, IncomingMessage } from "./types.js";

const { Client, LocalAuth } = pkg;

type RuntimeMessageId = {
  _serialized?: unknown;
  $1?: unknown;
  remote?: unknown;
  id?: unknown;
};

type RuntimeReaction = {
  aggregateEmoji?: unknown;
  hasReactionByMe?: boolean;
  senders?: Array<{ senderUserJid?: unknown; senderId?: unknown }>;
};

type RuntimeMessage = {
  id?: RuntimeMessageId | string;
  from: string;
  author?: string;
  fromMe: boolean;
  ack?: unknown;
  delete: (deleteForEveryone?: boolean) => Promise<void>;
  timestamp: number;
  body?: string;
  type?: string;
  hasMedia?: boolean;
  isGif?: boolean;
  isViewOnce?: unknown;
  isViewOnceV2?: unknown;
  _data?: Record<string, unknown> & {
    thumbnail?: string;
    mimetype?: string;
    isGif?: boolean;
    isViewOnce?: unknown;
    isViewOnceV2?: unknown;
  };
  getChat: () => Promise<{ id: { _serialized: string; user?: string }; name?: string }>;
  getContact: () => Promise<{ name?: string; pushname?: string; shortName?: string; verifiedName?: string }>;
  downloadMedia: () => Promise<{ mimetype: string; data: string; filename?: string | null } | null | undefined>;
};

function getMessageAck(message: { ack?: unknown; _data?: Record<string, unknown> & { ack?: unknown } }): number | undefined {
  const value = message.ack ?? message._data?.ack;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

type RuntimeReactionEvent = {
  msgId?: RuntimeMessageId | string;
  reaction?: unknown;
  senderId?: unknown;
};

function formatMessageBody(
  message: { body?: unknown; type?: unknown; fromMe?: unknown },
  media?: IncomingMessage["media"],
  viewOnce = false
): string {
  const type = typeof message.type === "string" ? message.type : "";
  if (type === "revoked") return "[Message deleted]";
  if (type === "call_log" || type === "call") {
    return message.fromMe === true ? "[Outgoing call]" : "[Incoming call]";
  }

  if (viewOnce) {
    return typeof message.body === "string" && message.body.trim() ? message.body : "[View-once media]";
  }

  const mediaKind = media?.kind || getMediaKind(message);
  if (mediaKind) {
    if (typeof message.body === "string" && message.body.trim()) return message.body;
    return `[${mediaKind === "sticker" ? "Sticker" : mediaKind === "gif" ? "GIF" : mediaKind === "audio" ? "Voice message" : "Image"}]`;
  }

  if (typeof message.body === "string" && message.body.trim()) return message.body;
  return "[System message]";
}

export function isViewOnceMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const runtimeMessage = message as {
    isViewOnce?: unknown;
    isViewOnceV2?: unknown;
    _data?: { isViewOnce?: unknown; isViewOnceV2?: unknown };
  };
  return runtimeMessage.isViewOnce === true || runtimeMessage.isViewOnceV2 === true
    || runtimeMessage._data?.isViewOnce === true || runtimeMessage._data?.isViewOnceV2 === true;
}

function getMediaKind(message: { type?: unknown; isGif?: unknown; _data?: { isGif?: unknown } }): NonNullable<IncomingMessage["media"]>["kind"] | undefined {
  const type = typeof message.type === "string" ? message.type : "";
  if (type === "sticker") return "sticker";
  if (type === "gif" || (type === "video" && (message.isGif === true || message._data?.isGif === true))) return "gif";
  if (type.startsWith("image")) return "image";
  if (type === "audio" || type === "ptt") return "audio";
  return undefined;
}

function getMessageId(message: { id?: RuntimeMessageId | string }, fallback: string): string {
  const id = message.id;
  if (typeof id === "string" && id) return id;
  if (!id || typeof id === "string") return fallback;
  if (typeof id._serialized === "string" && id._serialized) return id._serialized;
  if (typeof id.$1 === "string" && id.$1) return id.$1;
  if (typeof id.remote === "string" && typeof id.id === "string") {
    return `${id.remote}_${id.id}`;
  }
  console.warn("[whatsapp] message has no serialized ID", { fallback, idKeys: id && typeof id === "object" ? Object.keys(id) : typeof id });
  return fallback;
}

export function getChromiumSandboxArgs(platform: NodeJS.Platform = process.platform): string[] {
  // The tested Ubuntu environment cannot start Chromium with its default sandbox; Windows keeps Chromium's default sandbox.
  return platform === "linux" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];
}

export class WhatsAppService {
  private readonly client = new Client({
    authStrategy: new LocalAuth({
      clientId: process.env.SESSION_NAME ?? "decky-whatsapp"
    }),
    puppeteer: {
      headless: true,
      args: getChromiumSandboxArgs()
    }
  });

  private status: BridgeStatus = "starting";
  private readonly recentMessages: IncomingMessage[] = [];
  private readonly receivedChatIdsSinceSession = new Set<string>();
  private readonly reactionCache = new Map<string, string>();
  private readonly contactNameCache = new Map<string, string>();
  private readonly profilePicCache = new Map<string, string | null>();
  private readonly mediaCache = new Map<string, NonNullable<IncomingMessage["media"]>>();
  private readonly mediaRequests = new Map<string, Promise<IncomingMessage["media"]>>();
  private mediaCacheBytes = 0;
  private readonly listeners = new Set<(event: BridgeEvent) => void>();
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private reconnecting = false;
  private stopping = false;

  constructor() {
    this.client.on("loading_screen", (percent, message) => {
      console.log(`WhatsApp Web loading ${percent}%: ${message}`);
    });

    this.client.on("change_state", (state) => {
      console.log(`WhatsApp state changed: ${state}`);
    });

    this.client.on("remote_session_saved", () => {
      console.log("WhatsApp session saved");
    });

    this.client.on("qr", async (qr) => {
      this.status = "qr_required";
      if (process.env.DECKY_WHATSAPP_BACKGROUND !== "1") {
        console.log("\nScan this QR code from WhatsApp on your phone:\n");
        qrcodeTerminal.generate(qr, { small: true });
        console.log();
      }
      this.emit({ type: "status", status: this.status });
      this.emit({ type: "qr", dataUrl: await qrcode.toDataURL(qr) });
    });

    this.client.on("authenticated", () => {
      console.log("WhatsApp authenticated");
      this.status = "authenticated";
      this.emit({ type: "status", status: this.status });
    });

    this.client.on("ready", () => {
      console.log("WhatsApp client ready");
      this.status = "ready";
      this.reconnectAttempt = 0;
      this.emit({ type: "status", status: this.status });
    });

    this.client.on("auth_failure", () => {
      console.error("WhatsApp authentication failed");
      this.status = "auth_failure";
      this.emit({ type: "status", status: this.status });
    });

    this.client.on("disconnected", () => {
      console.error("WhatsApp client disconnected");
      this.status = "disconnected";
      this.emit({ type: "status", status: this.status });
      this.scheduleReconnect();
    });

    this.client.on("message", (message) => {
      void this.publishCreatedMessage(message as unknown as RuntimeMessage);
    });

    this.client.on("message_create", (message) => {
      // The normal message event covers incoming messages. message_create is
      // needed for messages sent from the phone or another linked device.
      if (message.fromMe) void this.publishCreatedMessage(message as unknown as RuntimeMessage);
    });

    this.client.on("message_edit", (message, newBody) => {
      void this.publishMessageUpdate(message as unknown as RuntimeMessage, "edited", typeof newBody === "string" ? newBody : undefined);
    });

    this.client.on("message_revoke_everyone", (message, revokedMessage) => {
      void this.publishMessageUpdate(
        (revokedMessage || message) as unknown as RuntimeMessage,
        "deleted"
      );
    });

    this.client.on("message_revoke_me", (message) => {
      void this.publishMessageUpdate(message as unknown as RuntimeMessage, "deleted");
    });

    this.client.on("message_ack", (message, ack) => {
      const runtimeMessage = message as unknown as RuntimeMessage;
      const messageId = getMessageId(runtimeMessage, "");
      if (!messageId) return;
      this.emit({ type: "message_ack", chatId: runtimeMessage.from, messageId, ack: Number(ack) });
    });

    this.client.on("message_reaction", (reaction) => {
      const event = reaction as unknown as RuntimeReactionEvent;
      const messageId = getMessageId({ id: event.msgId }, "");
      if (!messageId) return;
      const messageKey = event.msgId;
      const chatId = typeof messageKey === "object" && messageKey && typeof messageKey.remote === "string"
        ? messageKey.remote
        : "";
      if (!chatId) return;
      const senderId = typeof event.senderId === "string"
        ? event.senderId
        : event.senderId && typeof event.senderId === "object" && "_serialized" in event.senderId
          ? String((event.senderId as { _serialized?: unknown })._serialized || "")
          : "";
      const ownWid = this.client.info?.wid?._serialized;
      this.emit({
        type: "reaction",
        chatId,
        messageId,
        emoji: typeof event.reaction === "string" ? event.reaction : "",
        fromMe: typeof ownWid === "string" && senderId === ownWid
      });
    });
  }

  private async publishCreatedMessage(message: RuntimeMessage): Promise<void> {
    try {
      let chatId = message.from;
      let chatName = message.from;
      try {
        const chat = await message.getChat();
        chatId = chat.id._serialized;
        chatName = chat.name || chat.id.user || message.from;
      } catch {
        console.warn("[message] chat metadata lookup failed; using sender fallback");
      }

      // Keep background synchronization lightweight. Full media is fetched
      // only when the Deck opens or refreshes the conversation history.
      const media = undefined;
      const sender = await this.getSenderName(message);
      const viewOnce = isViewOnceMessage(message);
      const incoming: IncomingMessage = {
        id: getMessageId(message, `${chatId}:${message.timestamp}:${message.body || ""}`),
        chatId,
        chatName,
        sender,
        body: formatMessageBody(message, media, viewOnce),
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        ack: getMessageAck(message),
        viewOnce,
        mediaKind: getMediaKind(message),
        image: undefined,
        media: undefined
      };
      if (!incoming.fromMe) this.receivedChatIdsSinceSession.add(chatId);
      this.recentMessages.unshift(incoming);
      this.recentMessages.splice(50);
      console.log(`Synchronized WhatsApp message from ${incoming.sender} in ${incoming.chatName}`);
      this.emit({ type: "message", message: incoming });
    } catch {
      console.error("[message] created message synchronization failed");
    }
  }

  private async publishMessageUpdate(message: RuntimeMessage, update: "edited" | "deleted", body?: string): Promise<void> {
    try {
      if (update === "deleted") this.forgetMedia(getMessageId(message, ""));
      let chatId = message.from;
      let chatName = message.from;
      try {
        const chat = await message.getChat();
        chatId = chat.id._serialized;
        chatName = chat.name || chat.id.user || message.from;
      } catch {
        console.warn("[message] chat metadata lookup failed while synchronizing update");
      }

      const media = undefined;
      const sender = await this.getSenderName(message);
      const viewOnce = update !== "deleted" && isViewOnceMessage(message);
      const updatedMessage: IncomingMessage = {
        id: getMessageId(message, `${chatId}:${message.timestamp}:${body || message.body || ""}`),
        chatId,
        chatName,
        sender,
        body: update === "deleted" ? "[Message deleted]" : (body || formatMessageBody(message, media, viewOnce)),
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        viewOnce,
        mediaKind: update === "deleted" ? undefined : getMediaKind(message),
        image: undefined,
        media: undefined
      };
      this.emit({ type: "message_update", update, message: updatedMessage });
      console.log("Synchronized WhatsApp message update", { update, chatId, messageId: updatedMessage.id });
    } catch {
      console.error("[message] update synchronization failed");
    }
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  getRecentMessages(): IncomingMessage[] {
    return [...this.recentMessages];
  }

  async getRecentChats(limit?: number): Promise<{ chats: ChatSummary[]; hasMore: boolean }> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");

    try {
      console.log("[chats] requesting WhatsApp chats");
      let chats;
      try {
        chats = await this.client.getChats();
      } catch {
        console.warn("[chats] first WhatsApp chat request failed; retrying");
        await new Promise((resolve) => setTimeout(resolve, 750));
        chats = await this.client.getChats();
      }
      console.log(`[chats] WhatsApp returned ${chats.length} chats`);
      const sortedChats = [...chats].sort((left, right) => {
        const timestampOrder = (right.lastMessage?.timestamp ?? 0) - (left.lastMessage?.timestamp ?? 0);
        return timestampOrder || left.id._serialized.localeCompare(right.id._serialized);
      });
      const mappedChats = sortedChats.map((chat) => ({
          chatId: chat.id._serialized,
          chatName: chat.name || chat.id.user || chat.id._serialized,
          receivedSinceSession: this.receivedChatIdsSinceSession.has(chat.id._serialized),
          lastMessage: chat.lastMessage ? formatMessageBody(chat.lastMessage) : "",
          timestamp: chat.lastMessage?.timestamp ?? 0,
          unreadCount: chat.unreadCount ?? 0
        }));
      return { chats: limit ? mappedChats.slice(0, limit) : mappedChats, hasMore: Boolean(limit && mappedChats.length > limit) };
    } catch {
      console.error("[chats] unable to load recent WhatsApp chats");
      return this.getFallbackChats();
    }
  }

  async markChatRead(chatId: string): Promise<boolean> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");

    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const marked = await this.client.sendSeen(chatId);
        console.log(`[read] ${chatId}: ${marked ? "marked read" : "WhatsApp did not confirm"} (attempt ${attempt})`);
        if (marked) return true;
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        lastError = error;
        console.warn(`[read] failed to mark chat as read (attempt ${attempt})`);
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (lastError) throw lastError;
    return false;
  }

  async getProfilePicUrl(chatId: string): Promise<string | undefined> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");
    if (this.profilePicCache.has(chatId)) return this.profilePicCache.get(chatId) || undefined;
    try {
      console.log(`[profile] requesting profile picture for ${chatId}`);
      const profilePicUrl = await this.client.getProfilePicUrl(chatId);
      if (!profilePicUrl) {
        this.profilePicCache.set(chatId, null);
        console.log(`[profile] ${chatId}: none`);
        return undefined;
      }

      const imageResponse = await fetch(profilePicUrl, { signal: AbortSignal.timeout(10_000) });
      if (!imageResponse.ok) throw new Error(`profile image request failed (${imageResponse.status})`);
      const contentType = imageResponse.headers.get("content-type")?.split(";", 1)[0] || "image/jpeg";
      if (!contentType.startsWith("image/")) throw new Error(`unexpected profile image type: ${contentType}`);
      const imageData = Buffer.from(await imageResponse.arrayBuffer());
      if (imageData.length === 0 || imageData.length > 2_000_000) throw new Error("profile image size is invalid");

      const dataUrl = `data:${contentType};base64,${imageData.toString("base64")}`;
      this.profilePicCache.set(chatId, dataUrl);
      console.log(`[profile] ${chatId}: received`, { contentType, bytes: imageData.length });
      return dataUrl;
    } catch (error) {
      console.warn("[profile] profile picture lookup failed");
      throw error;
    }
  }

  // Load the latest history window and enrich messages with media and reactions.
  async getChatHistory(chatId: string, limit = 5, signal?: AbortSignal): Promise<{ messages: IncomingMessage[]; hasMore: boolean }> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");

    let chat;
    try {
      chat = await this.client.getChatById(chatId);
    } catch (lookupError) {
      console.warn("[history] direct chat lookup failed; searching loaded chats");
      let chats;
      try {
        chats = await this.client.getChats();
      } catch {
        console.warn("[history] loaded chat search failed; retrying");
        await new Promise((resolve) => setTimeout(resolve, 750));
        chats = await this.client.getChats();
      }
      const requestedUser = chatId.split("@", 1)[0];
      chat = chats.find((candidate) => candidate.id._serialized === chatId || candidate.id.user === requestedUser);
      if (!chat) {
        console.error(`[history] chat was not found after lookup and loaded-chat search`, {
          chatId,
          loadedChatCount: chats.length,
          sampleChatIds: chats.slice(0, 5).map((candidate) => candidate.id._serialized)
        });
        throw lookupError;
      }
      console.log(`[history] resolved ${chatId} through loaded chats as ${chat.id._serialized}`);
    }
    let messages;
    try {
      messages = await chat.fetchMessages({ limit: limit + 1 });
    } catch (historyError) {
      console.error("[history] message retrieval failed");
      throw historyError;
    }
    // whatsapp-web.js usually returns chronological messages, but cache order can
    // differ between platforms. Keep the source order for messages in the same
    // second so sent/reply order is not inferred from opaque WhatsApp IDs.
    const orderedMessages = [...messages].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
    const hasMore = orderedMessages.length > limit;
    const visibleMessages = hasMore ? orderedMessages.slice(-limit) : orderedMessages;
    const toIncoming = async (message: (typeof visibleMessages)[number]): Promise<IncomingMessage> => {
      const id = getMessageId(message, `${chatId}:${message.timestamp}:${message.body}`);
      const viewOnce = isViewOnceMessage(message);
      const media = viewOnce ? undefined : await this.getMedia(message);
      const sender = await this.getSenderName(message);
      let reaction: string | undefined = this.reactionCache.get(id);
      let reactionsList = reaction ? [reaction] : [];
      const hasReaction = (message as unknown as { _data?: { hasReaction?: boolean } })._data?.hasReaction === true;
      if (hasReaction || reaction) try {
        const page = this.client.pupPage;
        const reactions: RuntimeReaction[] = page ? await page.evaluate(async (targetMessageId) => {
          const runtimeWindow = window as typeof window & { require: (name: string) => any };
          if (!targetMessageId) return [];
          const messageReactions = await runtimeWindow.require("WAWebCollections").Reactions.find(targetMessageId);
          return messageReactions?.reactions?.serialize?.() ?? [];
        }, id) as RuntimeReaction[] : [];
        reactionsList = [...new Set((reactions ?? [])
          .map((candidate) => candidate.aggregateEmoji)
          .filter((emoji): emoji is string => Boolean(emoji)))];
        const ownWid = this.client.info?.wid?._serialized;
        const ownReaction = reactions?.find((candidate) => {
          if (candidate.hasReactionByMe) return true;
          if (typeof ownWid !== "string" || !candidate.senders) return false;
          return candidate.senders.some((sender) => {
            const senderId = sender.senderUserJid ?? sender.senderId;
            if (typeof senderId === "string") return senderId === ownWid;
            if (senderId && typeof senderId === "object" && "_serialized" in senderId) {
              return (senderId as { _serialized?: unknown })._serialized === ownWid;
            }
            return false;
          });
        })?.aggregateEmoji;
        if (typeof ownReaction === "string" && ownReaction) {
          reaction = ownReaction;
          this.reactionCache.set(id, ownReaction);
        } else {
          reaction = undefined;
          this.reactionCache.delete(id);
        }
      } catch {
        console.warn("[history] message reaction lookup failed");
      }
      return {
        id,
        chatId,
        chatName: chat.name || chat.id.user || chat.id._serialized,
        sender,
        body: formatMessageBody(message, media, viewOnce),
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        ack: getMessageAck(message),
        viewOnce,
        mediaKind: getMediaKind(message),
        reaction,
        reactions: reactionsList.length > 0 ? reactionsList : undefined,
        media
      };
    };
    const history = new Array<IncomingMessage>(visibleMessages.length);
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(4, visibleMessages.length) }, async () => {
      while (!signal?.aborted && nextIndex < visibleMessages.length) {
        const index = nextIndex++;
        history[index] = await toIncoming(visibleMessages[index]);
      }
    }));
    if (signal?.aborted) throw new Error("History request cancelled");
    return { messages: history, hasMore };
  }

  async start(): Promise<void> {
    this.stopping = false;
    console.log("Initializing WhatsApp Web client...");
    try {
      await this.client.initialize();
      if (this.stopping) await this.client.destroy().catch(() => undefined);
    } catch (error) {
      if (!this.stopping) {
        this.status = "disconnected";
        this.emit({ type: "status", status: this.status });
        this.scheduleReconnect();
      }
      throw error;
    }
  }

  async sendMessage(chatId: string, body: string, quotedMessageId?: string): Promise<void> {
    if (this.status !== "ready") {
      throw new Error("WhatsApp is not ready");
    }
    console.log("[whatsapp] sendMessage", {
      chatId,
      quotedMessageId: quotedMessageId || null,
      bodyLength: body.length
    });
    await this.client.sendMessage(chatId, body, quotedMessageId ? { quotedMessageId } : undefined);
    console.log("[whatsapp] sendMessage completed", { chatId, quotedMessageId: quotedMessageId || null });
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    let message = messages.find((candidate) => getMessageId(candidate, "") === messageId) as unknown as RuntimeMessage | undefined;
    if (!message) message = await this.client.getMessageById(messageId) as unknown as RuntimeMessage | undefined;
    if (!message) throw new Error("WhatsApp message could not be found");
    if (!message.fromMe) throw new Error("Only your own messages can be deleted");
    const page = this.client.pupPage;
    if (!page) throw new Error("WhatsApp browser page is not ready");
    const canDeleteForEveryone = await page.evaluate(async (targetMessageId: string) => {
      const runtimeWindow = window as typeof window & { require: (name: string) => any };
      const msg = runtimeWindow.require("WAWebCollections").Msg.get(targetMessageId)
        || (await runtimeWindow.require("WAWebCollections").Msg.getMessagesById([targetMessageId]))?.messages?.[0];
      return Boolean(msg && runtimeWindow.require("WAWebMsgActionCapability").canSenderRevokeMsg(msg));
    }, getMessageId(message, messageId));
    if (!canDeleteForEveryone) {
      throw new Error("WhatsApp no longer permits deleting this message for everyone");
    }
    await message.delete(true);
    this.forgetMedia(getMessageId(message, messageId));
    console.log("[whatsapp] message deleted", { chatId, messageId });
  }

  async reactToMessage(chatId: string, messageId: string, emoji: string): Promise<void> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    let message = messages.find((candidate) => getMessageId(candidate, "") === messageId);
    if (!message) {
      message = await this.client.getMessageById(messageId);
    }
    if (!message) throw new Error("WhatsApp message could not be found");
    const page = this.client.pupPage;
    if (!page) throw new Error("WhatsApp browser page is not ready");
    const serializedId = getMessageId(message, messageId);
    const dispatched = await page.evaluate(async (targetMessageId, reaction) => {
      const runtimeWindow = window as typeof window & { require: (name: string) => any };
      if (!targetMessageId) return false;
      const msg = runtimeWindow.require("WAWebCollections").Msg.get(targetMessageId)
        || (await runtimeWindow.require("WAWebCollections").Msg.getMessagesById([targetMessageId]))?.messages?.[0];
      if (!msg) return false;
      await runtimeWindow.require("WAWebSendReactionMsgAction").sendReactionToMsg(msg, reaction);
      return true;
    }, serializedId, emoji);
    if (!dispatched) {
      throw new Error(`WhatsApp could not locate message ${serializedId} for reaction`);
    }
    if (emoji) this.reactionCache.set(serializedId, emoji);
    else this.reactionCache.delete(serializedId);
    console.log("[whatsapp] reaction dispatched", { chatId, messageId: serializedId, emoji });
  }

  // Shutdown cancels retries; recovery reinitializes the client with bounded backoff.
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempt = 0;
    await this.client.destroy().catch(() => {
      console.warn("[whatsapp] client shutdown reported an error");
    });
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnecting || this.reconnectTimer) return;
    const delay = Math.min(30_000, 2_000 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    console.log(`[whatsapp] reconnect scheduled in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.stopping || this.reconnecting) return;
    this.reconnecting = true;
    let retry = false;
    this.status = "starting";
    this.emit({ type: "status", status: this.status });
    try {
      await this.client.destroy().catch(() => undefined);
      if (this.stopping) return;
      await this.client.initialize();
      if (this.stopping) {
        await this.client.destroy().catch(() => undefined);
        return;
      }
      console.log("[whatsapp] reconnect attempt started");
    } catch {
      console.error("[whatsapp] reconnect attempt failed");
      this.status = "disconnected";
      this.emit({ type: "status", status: this.status });
      retry = true;
    } finally {
      this.reconnecting = false;
      if (retry || this.getStatus() === "disconnected") this.scheduleReconnect();
    }
  }

  private emit(event: BridgeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async getSenderName(message: { from: string; author?: string; fromMe?: boolean; getContact: () => Promise<{ name?: string; pushname?: string; shortName?: string; verifiedName?: string }> }): Promise<string> {
    if (message.fromMe) return "You";
    const cacheKey = message.author || message.from;
    const cachedName = this.contactNameCache.get(cacheKey);
    if (cachedName) return cachedName;
    try {
      const contact = await message.getContact();
      const name = contact.name || contact.pushname || contact.shortName || contact.verifiedName || message.author || message.from;
      this.contactNameCache.set(cacheKey, name);
      return name;
    } catch {
      console.warn("[message] contact name lookup failed; using sender fallback");
      const fallback = message.author || message.from;
      this.contactNameCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  // Share in-flight downloads and reuse cached media across concurrent history reads.
  private async getMedia(message: RuntimeMessage): Promise<IncomingMessage["media"]> {
    if (isViewOnceMessage(message)) return undefined;
    if (!message.hasMedia || !getMediaKind(message)) return undefined;
    const id = getMessageId(message, "");
    if (!id) return this.downloadMedia(message);
    const cached = this.mediaCache.get(id);
    if (cached) {
      this.mediaCache.delete(id);
      this.mediaCache.set(id, cached);
      return cached;
    }
    const pending = this.mediaRequests.get(id);
    if (pending) return pending;
    const request: Promise<IncomingMessage["media"]> = this.downloadMedia(message).then((media) => {
      // Deletion invalidates an in-flight request as well as cached media.
      if (media && this.mediaRequests.get(id) === request) {
        const bytes = media.dataUrl.length * 2;
        if (bytes > 64 * 1024 * 1024) return media;
        while (this.mediaCache.size && (this.mediaCache.size >= 50 || this.mediaCacheBytes + bytes > 64 * 1024 * 1024)) {
          this.forgetMedia(this.mediaCache.keys().next().value!);
        }
        this.mediaCache.set(id, media);
        this.mediaCacheBytes += bytes;
      }
      return this.mediaRequests.get(id) === request ? media : undefined;
    }).finally(() => {
      if (this.mediaRequests.get(id) === request) this.mediaRequests.delete(id);
    });
    this.mediaRequests.set(id, request);
    return request;
  }

  private forgetMedia(id: string): void {
    const cached = this.mediaCache.get(id);
    if (cached) this.mediaCacheBytes -= cached.dataUrl.length * 2;
    this.mediaCache.delete(id);
    this.mediaRequests.delete(id);
  }

  private async downloadMedia(message: RuntimeMessage): Promise<IncomingMessage["media"]> {
    const isSticker = message.type === "sticker";
    const isGif = message.type === "gif" || (message.type === "video" && (message.isGif === true || message._data?.isGif === true));
    const isImage = message.type?.startsWith("image") === true;
    const isAudio = message.type === "audio" || message.type === "ptt";
    if (!message.hasMedia || (!isImage && !isSticker && !isGif && !isAudio)) return undefined;

    const mediaInfo = {
      id: getMessageId(message, "unknown"),
      type: message.type,
      hasMedia: message.hasMedia,
      dataKeys: Object.keys(message._data || {}),
      thumbnailType: typeof message._data?.thumbnail,
      thumbnailLength: typeof message._data?.thumbnail === "string" ? message._data.thumbnail.length : 0,
      mimetype: message._data?.mimetype || "unknown"
    };
    const kind = isSticker ? "sticker" : isGif ? "gif" : isAudio ? "audio" : "image";
    console.log("[media] media received", JSON.stringify({ ...mediaInfo, kind }));

    const thumbnail = message._data?.thumbnail;
    // WhatsApp may attach a thumbnail to voice messages, but it is an image
    // preview and cannot be used as the audio source.
    if (kind === "image" && typeof thumbnail === "string" && thumbnail.length > 0) {
      const dataUrl = thumbnail.startsWith("data:")
        ? thumbnail
        : `data:image/jpeg;base64,${thumbnail}`;
      console.log("[media] using WhatsApp thumbnail", JSON.stringify({ id: mediaInfo.id, length: thumbnail.length }));
      return { dataUrl, kind, mimetype: dataUrl.slice(5, dataUrl.indexOf(";")) || "image/jpeg" };
    }

    try {
      console.log("[media] requesting full media", JSON.stringify({ id: mediaInfo.id }));
      const media = await message.downloadMedia();
      if (!media) {
        console.warn("[media] WhatsApp returned no media", JSON.stringify({ id: mediaInfo.id }));
        return undefined;
      }
      console.log("[media] full media received", JSON.stringify({ id: mediaInfo.id, mimetype: media.mimetype, base64Length: media.data.length, kind }));
      const supported = media.mimetype.startsWith("image/") || media.mimetype.startsWith("audio/") || (kind === "gif" && media.mimetype.startsWith("video/"));
      if (!supported || media.data.length > 12_000_000) return undefined;
      return {
        dataUrl: `data:${media.mimetype};base64,${media.data}`,
        filename: media.filename || undefined,
        kind,
        mimetype: media.mimetype
      };
    } catch {
      console.error("[media] full media download failed");
      return undefined;
    }
  }

  private getFallbackChats(): { chats: ChatSummary[]; hasMore: boolean } {
    const byChat = new Map<string, ChatSummary>();
    for (const message of this.recentMessages) {
      if (!byChat.has(message.chatId)) {
        byChat.set(message.chatId, {
          chatId: message.chatId,
          chatName: message.chatName,
          lastMessage: message.body,
          timestamp: message.timestamp,
          unreadCount: 0
        });
      }
    }
    return { chats: [...byChat.values()].slice(0, 5), hasMore: false };
  }
}
