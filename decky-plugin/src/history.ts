import type { IncomingMessage } from "./types/message";

export const INITIAL_COMPACT_HISTORY_LIMIT = 5;
export const HISTORY_EXPANSION_SIZE = 10;
export const MAX_HISTORY_LIMIT = 100;

/** Return the next cumulative request size, or undefined when no safe expansion remains. */
export function getNextHistoryLimit(currentLimit: number, hasMore: boolean): number | undefined {
  if (!hasMore || currentLimit >= MAX_HISTORY_LIMIT) return undefined;
  return Math.min(currentLimit + HISTORY_EXPANSION_SIZE, MAX_HISTORY_LIMIT);
}

/** Focus the older message directly before the previous oldest visible boundary. */
export function getHistoryExpansionFocusId(messages: IncomingMessage[], previousBoundaryId: string): string | undefined {
  const boundaryIndex = messages.findIndex((message) => message.id === previousBoundaryId);
  return boundaryIndex > 0 ? messages[boundaryIndex - 1]?.id : undefined;
}

export function compareHistoryMessages(left: IncomingMessage, right: IncomingMessage): number {
  // Stable sorting preserves fetch/arrival order when WhatsApp timestamps share a second.
  return left.timestamp - right.timestamp;
}

export class RecentLiveMessageCache {
  private readonly messages = new Map<string, IncomingMessage>();
  sessionId = "";

  setSession(sessionId: string): boolean {
    if (this.sessionId === sessionId) return false;
    const previousSessionId = this.sessionId;
    this.sessionId = sessionId;
    if (previousSessionId && sessionId && previousSessionId !== sessionId) this.messages.clear();
    return true;
  }

  isCurrentSession(sessionId: string): boolean {
    return this.sessionId === sessionId;
  }

  clear(): void {
    this.messages.clear();
  }

  reset(): void {
    this.messages.clear();
    this.sessionId = "";
  }

  remember(message: IncomingMessage, limit = 500): void {
    this.messages.delete(message.id);
    this.messages.set(message.id, message);
    while (this.messages.size > limit) this.messages.delete(this.messages.keys().next().value!);
  }

  update(messageId: string, updater: (message: IncomingMessage) => IncomingMessage): void {
    const message = this.messages.get(messageId);
    if (message) this.messages.set(messageId, updater(message));
  }

  values(): IterableIterator<IncomingMessage> {
    return this.messages.values();
  }
}

export class HistoryRequestLifecycle {
  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return this.generation === generation;
  }
}

export function mergeHistorySnapshot(
  snapshot: IncomingMessage[],
  additionalMessages: Iterable<IncomingMessage>,
  chatId: string
): IncomingMessage[] {
  const merged = new Map(snapshot.map((message) => [message.id, message]));
  for (const message of additionalMessages) {
    if (message.chatId === chatId && !merged.has(message.id)) merged.set(message.id, message);
  }
  return [...merged.values()].sort(compareHistoryMessages);
}
