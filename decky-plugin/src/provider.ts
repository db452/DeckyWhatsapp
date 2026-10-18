import type { ChatSummary } from "./types/chat";
import type { IncomingMessage } from "./types/message";

export type BridgeStatus = "starting" | "qr_required" | "authenticated" | "ready" | "disconnected" | "auth_failure" | "disabled" | "unknown";
export type BridgeEvent =
  | { type: "status"; status: BridgeStatus; sessionId?: string }
  | { type: "message"; message: IncomingMessage }
  | { type: "message_update"; update: "edited" | "deleted"; message: IncomingMessage }
  | { type: "message_ack"; chatId: string; messageId: string; ack: number }
  | { type: "reaction"; chatId: string; messageId: string; emoji: string; fromMe: boolean };

export type Operation = "chats" | "health" | "profile" | "history" | "read" | "send" | "delete" | "react";
export type OperationPayload = {
  chatId?: string;
  messageId?: string;
  body?: string;
  quotedMessageId?: string;
  emoji?: string;
  limit?: number;
};

export type ProviderResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};
export type ProviderConnection = { close(): void; readonly connected: boolean };

export interface DataProvider {
  readonly variant: "production" | "mock";
  readonly pluginName: string;
  readonly label: string;
  readonly voiceEnabled: boolean;
  configure(baseUrl: string): void;
  request(operation: Operation, payload?: OperationPayload, signal?: AbortSignal): Promise<ProviderResponse>;
  searchContacts(query: string): ChatSummary[];
  subscribe(onEvent: (event: BridgeEvent) => void, onOpen: () => void, onError: () => void, onClose: () => void): ProviderConnection;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  voiceStatus(): Promise<{ available: boolean; reason?: string }>;
  transcribe(audioBase64: string): Promise<string>;
  editMockMessage(chatId: string, messageId: string, body: string): Promise<boolean>;
  simulateIncoming(): void;
  switchSession(): void;
  simulateDelay(milliseconds: number): void;
  simulateSendFailure(): void;
  simulateMediaFailure(messageId?: string): void;
  simulateReconnect(): void;
  simulateError(): void;
  reset(): void;
}
