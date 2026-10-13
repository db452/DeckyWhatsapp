export type BridgeStatus =
  | "starting"
  | "qr_required"
  | "authenticated"
  | "ready"
  | "disconnected"
  | "auth_failure";

export type BridgeEvent =
  | { type: "status"; status: BridgeStatus }
  | { type: "qr"; dataUrl: string }
  | { type: "message"; message: IncomingMessage }
  | { type: "message_update"; update: "edited" | "deleted"; message: IncomingMessage }
  | { type: "message_ack"; chatId: string; messageId: string; ack: number }
  | { type: "reaction"; chatId: string; messageId: string; emoji: string; fromMe: boolean };

export interface IncomingMessage {
  id: string;
  chatId: string;
  chatName: string;
  sender: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  ack?: number;
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
