import { call } from "@decky/api";
import { connectSocket, fetchWithTimeout } from "./connection";
import type { BridgeEvent, DataProvider, Operation, OperationPayload, ProviderConnection, ProviderResponse } from "./provider";

const storagePrefix = "decky-whatsapp-";
let baseUrl = "http://127.0.0.1:8787";
let bridgeToken = "";
let tokenRequest: Promise<string> | undefined;

async function getToken(): Promise<string> {
  if (bridgeToken) return bridgeToken;
  if (!tokenRequest) tokenRequest = fetchWithTimeout(`${baseUrl}/bootstrap`, { cache: "no-store" }, 10_000)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Bridge bootstrap failed (${response.status})`);
      const body = await response.json() as { token?: unknown };
      if (typeof body.token !== "string" || !body.token) throw new Error("Bridge returned an invalid token");
      bridgeToken = body.token;
      return bridgeToken;
    }).finally(() => { tokenRequest = undefined; });
  return tokenRequest;
}

function endpoint(operation: Operation, payload: OperationPayload): { path: string; method?: string; body?: unknown } {
  const id = encodeURIComponent(payload.chatId || "");
  switch (operation) {
    case "chats": return { path: "/chats" };
    case "health": return { path: "/health" };
    case "profile": return { path: `/chats/${id}/profile` };
    case "history": return { path: `/chats/${id}/messages?limit=${payload.limit || 50}` };
    case "read": return { path: `/chats/${id}/read`, method: "POST" };
    case "send": return { path: "/messages", method: "POST", body: { chatId: payload.chatId, body: payload.body, quotedMessageId: payload.quotedMessageId } };
    case "delete": return { path: "/messages/delete", method: "POST", body: { chatId: payload.chatId, messageId: payload.messageId } };
    case "react": return { path: "/reactions", method: "POST", body: { chatId: payload.chatId, messageId: payload.messageId, emoji: payload.emoji } };
  }
}

async function request(operation: Operation, payload: OperationPayload = {}, signal?: AbortSignal, retrying = false): Promise<ProviderResponse> {
  const route = endpoint(operation, payload);
  const token = await getToken();
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (route.body) headers.set("Content-Type", "application/json");
  const response = await fetchWithTimeout(`${baseUrl}${route.path}`, {
    method: route.method,
    headers,
    body: route.body ? JSON.stringify(route.body) : undefined,
    signal
  });
  if (response.status === 401 && !retrying) {
    bridgeToken = "";
    return request(operation, payload, signal, true);
  }
  return response;
}

export const provider: DataProvider = {
  variant: "production",
  pluginName: "Decky WhatsApp",
  label: "WhatsApp",
  voiceEnabled: true,
  configure(url) { baseUrl = url.replace(/\/$/, ""); bridgeToken = ""; },
  request: (operation, payload, signal) => request(operation, payload, signal),
  searchContacts() { return []; },
  subscribe(onEvent, onOpen, onError, onClose): ProviderConnection {
    return connectSocket({
      url: async () => {
        const token = await getToken();
        const url = new URL(baseUrl);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = "/events";
        url.search = new URLSearchParams({ token }).toString();
        return url.toString();
      },
      onOpen,
      onError,
      onClose: () => { bridgeToken = ""; onClose(); },
      onMessage(data) { try { onEvent(JSON.parse(data) as BridgeEvent); } catch { onError(); } }
    });
  },
  storageGet(key) { return window.localStorage.getItem(`${storagePrefix}${key}`); },
  storageSet(key, value) { window.localStorage.setItem(`${storagePrefix}${key}`, value); },
  voiceStatus() { return call<[], { available: boolean; reason?: string }>("voice_typing_status"); },
  transcribe(audioBase64) { return call<[string], string>("transcribe_audio", audioBase64); },
  async editMockMessage() { return false; },
  simulateIncoming() {}, switchSession() {}, simulateDelay() {}, simulateSendFailure() {}, simulateMediaFailure() {}, simulateReconnect() {}, simulateError() {}, reset() {}
};
