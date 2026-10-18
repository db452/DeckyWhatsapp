// Shared message payload used by bridge events, history, and conversation rendering.
export type IncomingMessage = {
  id: string;
  chatId: string;
  chatName: string;
  sender: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  ack?: number;
  viewOnce?: boolean;
  deliveryUncertain?: boolean;
  sendFailureNotice?: string;
  mediaLoadState?: "loading" | "unavailable";
  quotedMessageId?: string;
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
};
