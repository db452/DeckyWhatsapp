import type { BridgeEvent } from "../providers/provider";

export type ReactionNotification = {
  id: string;
  timestamp: number;
  emoji: string;
};

// Only complete, unambiguous reaction events can produce a notification.
export function getReactionNotification(event: BridgeEvent): ReactionNotification | undefined {
  if (event.type !== "reaction" || event.fromMe !== false || event.actorIsMe !== false || event.parentFromMe !== true) return undefined;
  if (
    typeof event.chatId !== "string" || !event.chatId.trim() ||
    typeof event.messageId !== "string" || !event.messageId.trim() ||
    typeof event.reactionId !== "string" || !event.reactionId.trim() ||
    typeof event.emoji !== "string" || !event.emoji.trim() ||
    typeof event.timestamp !== "number" || !Number.isSafeInteger(event.timestamp) || event.timestamp <= 0
  ) return undefined;

  return { id: `${event.chatId}:${event.reactionId}`, timestamp: event.timestamp, emoji: event.emoji };
}
