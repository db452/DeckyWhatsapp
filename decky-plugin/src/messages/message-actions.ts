import type { IncomingMessage } from "../types/message";

export type MessageYAction = "toggle-audio" | "toggle-video" | "open-image";

export interface MessageYPressOptions {
  isTextEntryFocused: () => boolean;
  isReplyInputActive: () => boolean;
  activateMessage: (messageId: string) => boolean;
}

/** Routes Y only to supported message actions while leaving typing untouched. */
export function createMessageYPressHandler(options: MessageYPressOptions) {
  return (messageId: string): boolean => {
    if (!messageId || options.isTextEntryFocused() || options.isReplyInputActive()) return false;
    return options.activateMessage(messageId);
  };
}

/** Y opens loaded images and otherwise toggles supported audio or ordinary video playback. */
export function getMessageYAction(message?: IncomingMessage, providerVariant: "production" | "mock" = "production"): MessageYAction | undefined {
  if (!message || message.viewOnce || message.mediaLoadState) return undefined;
  const media = message.media || (message.image ? { ...message.image, kind: "image" as const, mimetype: "image/jpeg" } : undefined);
  if (!media?.dataUrl) return undefined;
  if (media.kind === "image") return "open-image";
  if (media.kind === "audio") return "toggle-audio";
  if (media.kind === "video") return "toggle-video";
  return undefined;
}
