import type { IncomingMessage } from "../types/message";

export type MessageYAction = "toggle-audio" | "toggle-video";

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

/** Images remain inline; Y toggles playback only for supported audio and ordinary video. */
export function getMessageYAction(message?: IncomingMessage): MessageYAction | undefined {
  const media = message?.media;
  if (!media?.dataUrl || message?.viewOnce) return undefined;
  if (media.kind === "audio") return "toggle-audio";
  if (media.kind === "video") return "toggle-video";
  return undefined;
}
