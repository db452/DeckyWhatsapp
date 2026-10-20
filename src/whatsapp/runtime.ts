import type { IncomingMessage } from "../types.js";

export type RuntimeMessageId = {
  _serialized?: unknown;
  $1?: unknown;
  remote?: unknown;
  id?: unknown;
  fromMe?: unknown;
};

export type RuntimeMessage = {
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

export type RuntimeReaction = {
  aggregateEmoji?: unknown;
  hasReactionByMe?: boolean;
  senders?: Array<{ senderUserJid?: unknown; senderId?: unknown }>;
};

export type RuntimeReactionEvent = {
  id?: RuntimeMessageId | string;
  msgId?: RuntimeMessageId | string;
  reaction?: unknown;
  senderId?: unknown;
  timestamp?: unknown;
};

export function getMessageAck(message: { ack?: unknown; _data?: Record<string, unknown> & { ack?: unknown } }): number | undefined {
  const value = message.ack ?? message._data?.ack;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
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

export function getMediaKind(message: { type?: unknown; isGif?: unknown; isViewOnce?: unknown; isViewOnceV2?: unknown; _data?: { isGif?: unknown; isViewOnce?: unknown; isViewOnceV2?: unknown } }): NonNullable<IncomingMessage["media"]>["kind"] | undefined {
  const type = typeof message.type === "string" ? message.type : "";
  if (type === "sticker") return "sticker";
  if (type === "video" && isViewOnceMessage(message)) return undefined;
  if (type === "gif" || (type === "video" && (message.isGif === true || message._data?.isGif === true))) return "gif";
  if (type === "video") return "video";
  if (type.startsWith("image")) return "image";
  if (type === "audio" || type === "ptt") return "audio";
  return undefined;
}

export function getMessageId(message: { id?: RuntimeMessageId | string }, fallback: string): string {
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

export function getMessageKeyDetails(key: RuntimeMessageId | string): { remote?: string; fromMe?: boolean } {
  const objectKey = typeof key === "object" && key ? key : undefined;
  const serialized = typeof key === "string"
    ? key
    : typeof objectKey?._serialized === "string" ? objectKey._serialized
      : typeof objectKey?.$1 === "string" ? objectKey.$1
        : undefined;
  // WhatsApp Web's renamed key form is "<fromMe>_<remote>_<message id>".
  const match = serialized?.match(/^(true|false)_([^_]+)_(.+)$/);

  return {
    ...(typeof objectKey?.remote === "string" ? { remote: objectKey.remote } : match ? { remote: match[2] } : {}),
    ...(typeof objectKey?.fromMe === "boolean" ? { fromMe: objectKey.fromMe } : match ? { fromMe: match[1] === "true" } : {})
  };
}

export function formatMessageBody(
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
    return `[${mediaKind === "sticker" ? "Sticker" : mediaKind === "gif" ? "GIF" : mediaKind === "audio" ? "Voice message" : mediaKind === "video" ? "Video" : "Image"}]`;
  }

  if (typeof message.body === "string" && message.body.trim()) return message.body;
  return "[System message]";
}
