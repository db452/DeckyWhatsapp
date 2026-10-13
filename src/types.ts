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
  | { type: "message"; message: IncomingMessage };

export interface IncomingMessage {
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
