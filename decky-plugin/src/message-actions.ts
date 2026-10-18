import type { IncomingMessage } from "./types/message";

export type MessageYAction = "toggle-audio";

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

/** Images remain inline; only playable audio has a Y action. */
export function getMessageYAction(message?: IncomingMessage): MessageYAction | undefined {
  const media = message?.media;
  return media?.kind === "audio" && media.dataUrl ? "toggle-audio" : undefined;
}
