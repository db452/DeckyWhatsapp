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

function formatMessageBody(
  message: { body?: unknown; type?: unknown; fromMe?: unknown },
  media?: IncomingMessage["media"]
): string {
  const type = typeof message.type === "string" ? message.type : "";
  if (type === "revoked") return "[Message deleted]";
  if (type === "call_log" || type === "call") {
    return message.fromMe === true ? "[Outgoing call]" : "[Incoming call]";
  }

  if (media) {
    return `[${media.kind === "sticker" ? "Sticker" : media.kind === "gif" ? "GIF" : media.kind === "audio" ? "Voice message" : "Image"}]`;
  }

  if (typeof message.body === "string" && message.body.trim()) return message.body;
  return "[System message]";
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

export class WhatsAppService {
  private readonly client = new Client({
    authStrategy: new LocalAuth({
      clientId: process.env.SESSION_NAME ?? "decky-whatsapp"
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });

  private status: BridgeStatus = "starting";
  private readonly recentMessages: IncomingMessage[] = [];
  private readonly receivedChatIdsSinceSession = new Set<string>();
  private readonly reactionCache = new Map<string, string>();
  private readonly contactNameCache = new Map<string, string>();
  private readonly profilePicCache = new Map<string, string | null>();
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
      console.log("\nScan this QR code from WhatsApp on your phone:\n");
      qrcodeTerminal.generate(qr, { small: true });
      console.log();
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

    this.client.on("message", async (message) => {
      try {
        let chatId = message.from;
        let chatName = message.from;
        try {
          const chat = await message.getChat();
          chatId = chat.id._serialized;
          chatName = chat.name || message.from;
        } catch (error) {
          console.error("Could not load WhatsApp chat metadata; using message sender as chat ID", error);
        }

        const media = await this.getMedia(message);

        const sender = await this.getSenderName(message);
        const incoming: IncomingMessage = {
          id: getMessageId(message, `${chatId}:${message.timestamp}:${message.body}`),
          chatId,
          chatName,
          sender,
          body: formatMessageBody(message, media),
          timestamp: message.timestamp,
          fromMe: message.fromMe,
          image: media?.kind === "image" ? { dataUrl: media.dataUrl, filename: media.filename } : undefined,
          media
        };
        if (!incoming.fromMe) this.receivedChatIdsSinceSession.add(chatId);
        this.recentMessages.unshift(incoming);
        this.recentMessages.splice(50);
        console.log(`Received WhatsApp message from ${incoming.sender} in ${incoming.chatName}`);
        this.emit({ type: "message", message: incoming });
      } catch (error) {
        console.error("Unable to process incoming WhatsApp message", error);
      }
    });
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
      } catch (firstError) {
        console.warn("[chats] first WhatsApp chat request failed; retrying", firstError);
        await new Promise((resolve) => setTimeout(resolve, 750));
        chats = await this.client.getChats();
      }
      console.log(`[chats] WhatsApp returned ${chats.length} chats`);
      const sortedChats = chats.sort((left, right) => (right.lastMessage?.timestamp ?? 0) - (left.lastMessage?.timestamp ?? 0));
      const mappedChats = sortedChats.map((chat) => ({
          chatId: chat.id._serialized,
          chatName: chat.name || chat.id.user || chat.id._serialized,
          receivedSinceSession: this.receivedChatIdsSinceSession.has(chat.id._serialized),
          lastMessage: chat.lastMessage ? formatMessageBody(chat.lastMessage) : "",
          timestamp: chat.lastMessage?.timestamp ?? 0,
          unreadCount: chat.unreadCount ?? 0
        }));
      return { chats: limit ? mappedChats.slice(0, limit) : mappedChats, hasMore: Boolean(limit && mappedChats.length > limit) };
    } catch (error) {
      console.error("[chats] unable to load recent WhatsApp chats", error);
      return this.getFallbackChats();
    }
  }

  async getProfilePicUrl(chatId: string): Promise<string | undefined> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");
    if (this.profilePicCache.has(chatId)) return this.profilePicCache.get(chatId) || undefined;
    try {
      console.log(`[profile] requesting profile picture for ${chatId}`);
      const profilePicUrl = await this.client.getProfilePicUrl(chatId);
      this.profilePicCache.set(chatId, profilePicUrl || null);
      console.log(`[profile] ${chatId}: ${profilePicUrl ? "received" : "none"}`);
      return profilePicUrl;
    } catch (error) {
      this.profilePicCache.set(chatId, null);
      console.warn(`[profile] lookup failed for ${chatId}`, error);
      return undefined;
    }
  }

  async getChatHistory(chatId: string, limit = 5): Promise<{ messages: IncomingMessage[]; hasMore: boolean }> {
    if (this.status !== "ready") throw new Error("WhatsApp is not ready");

    let chat;
    try {
      chat = await this.client.getChatById(chatId);
    } catch (lookupError) {
      console.warn(`[history] direct chat lookup failed for ${chatId}; searching loaded chats`, lookupError);
      let chats;
      try {
        chats = await this.client.getChats();
      } catch (firstChatsError) {
        console.warn(`[history] loaded chat search failed for ${chatId}; retrying`, firstChatsError);
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
      console.error(`[history] message retrieval failed for ${chatId}`, historyError);
      throw historyError;
    }
    const hasMore = messages.length > limit;
    const visibleMessages = hasMore ? messages.slice(-limit) : messages;
    return { messages: await Promise.all(visibleMessages.map(async (message) => {
      const id = getMessageId(message, `${chatId}:${message.timestamp}:${message.body}`);
      const media = await this.getMedia(message);
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
        }
      } catch (error) {
        console.warn("Could not load message reactions", error instanceof Error ? error.message : String(error));
      }
      return {
        id,
        chatId,
        chatName: chat.name || chat.id.user || chat.id._serialized,
        sender,
        body: formatMessageBody(message, media),
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        reaction,
        reactions: reactionsList.length > 0 ? reactionsList : undefined,
        image: media?.kind === "image" ? { dataUrl: media.dataUrl, filename: media.filename } : undefined,
        media
      };
    })), hasMore };
  }

  async start(): Promise<void> {
    this.stopping = false;
    console.log("Initializing WhatsApp Web client...");
    await this.client.initialize();
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

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempt = 0;
    await this.client.destroy().catch((error) => {
      console.warn("WhatsApp client was already stopped", error instanceof Error ? error.message : String(error));
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
    this.status = "starting";
    this.emit({ type: "status", status: this.status });
    try {
      await this.client.destroy().catch(() => undefined);
      await this.client.initialize();
      console.log("[whatsapp] reconnect attempt started");
    } catch (error) {
      console.error("[whatsapp] reconnect attempt failed", error);
      this.status = "disconnected";
      this.emit({ type: "status", status: this.status });
      this.scheduleReconnect();
    } finally {
      this.reconnecting = false;
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
    } catch (error) {
      console.warn("Could not resolve WhatsApp contact name", error instanceof Error ? error.message : String(error));
      const fallback = message.author || message.from;
      this.contactNameCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  private async getMedia(message: { id?: { _serialized?: string; $1?: string }; hasMedia?: boolean; type?: string; isGif?: boolean; _data?: Record<string, unknown> & { thumbnail?: string; mimetype?: string; isGif?: boolean }; downloadMedia: () => Promise<{ mimetype: string; data: string; filename?: string | null } | null | undefined> }): Promise<IncomingMessage["media"]> {
    const isSticker = message.type === "sticker";
    const isGif = message.type === "gif" || (message.type === "video" && (message.isGif === true || message._data?.isGif === true));
    const isImage = message.type?.startsWith("image") === true;
    const isAudio = message.type === "audio" || message.type === "ptt";
    if (!message.hasMedia || (!isImage && !isSticker && !isGif && !isAudio)) return undefined;

    const mediaInfo = {
      id: message.id?._serialized || message.id?.$1 || "unknown",
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
    if (kind !== "audio" && typeof thumbnail === "string" && thumbnail.length > 0) {
      const dataUrl = thumbnail.startsWith("data:")
        ? thumbnail
        : `data:${message._data?.mimetype || "image/jpeg"};base64,${thumbnail}`;
      console.log("[media] using WhatsApp thumbnail", JSON.stringify({ id: mediaInfo.id, length: thumbnail.length }));
      return { dataUrl, kind, mimetype: message._data?.mimetype || "image/jpeg" };
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
    } catch (error) {
      console.error("[media] full media failed", JSON.stringify({
        id: mediaInfo.id,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
      }));
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
