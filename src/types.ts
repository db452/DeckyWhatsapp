// Shared bridge event, chat, and message data shapes.
export type BridgeStatus =
  | "starting"
  | "qr_required"
  | "authenticated"
  | "ready"
  | "disconnected"
  | "auth_failure";

export type BridgeEvent =
  | { type: "status"; status: BridgeStatus; sessionId?: string }
  | { type: "qr"; dataUrl: string }
  | { type: "message"; message: IncomingMessage }
  | { type: "message_update"; update: "edited" | "deleted"; message: IncomingMessage }
  | { type: "message_ack"; chatId: string; messageId: string; ack: number }
  | {
      type: "reaction";
      chatId: string;
      messageId: string;
      emoji: string;
      /** Whether the current user sent this reaction (kept for conversation UI updates). */
      fromMe: boolean;
      /** Reaction identity and attribution used by fail-closed notification handling. */
      reactionId?: string;
      actorId?: string;
      actorIsMe?: boolean;
      parentFromMe?: boolean;
      timestamp?: number;
    };

export interface IncomingMessage {
  id: string;
  chatId: string;
  chatName: string;
  sender: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  ack?: number;
  viewOnce?: boolean;
  mediaKind?: "image" | "sticker" | "gif" | "audio" | "video";
  reaction?: string;
  reactions?: string[];
  image?: {
    dataUrl: string;
    filename?: string;
  };
  media?: {
    dataUrl: string;
    filename?: string;
    kind: "image" | "sticker" | "gif" | "audio" | "video";
    mimetype: string;
  };
}

export interface ChatSummary {
  chatId: string;
  chatName: string;
  profilePicUrl?: string;
  receivedSinceSession?: boolean;
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
}
