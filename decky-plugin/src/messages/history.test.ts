import assert from "node:assert/strict";
import { test } from "node:test";
import { getHistoryExpansionFocusId, getNextHistoryLimit, HistoryRequestLifecycle, mergeHistorySnapshot, RecentLiveMessageCache } from "./history";
import type { IncomingMessage } from "../types/message";

function message(id: string, timestamp: number, chatId = "chat"): IncomingMessage {
  return { id, chatId, chatName: "Chat", sender: "You", body: id, timestamp, fromMe: true };
}

test("history expansion focuses the older neighbor of its previous oldest boundary", () => {
  const firstBatch = Array.from({ length: 15 }, (_, index) => message(`message-${index + 1}`, index + 1));
  const secondBatch = Array.from({ length: 25 }, (_, index) => message(`message-${index + 1}`, index + 1));

  assert.equal(getNextHistoryLimit(5, true), 15);
  assert.equal(getHistoryExpansionFocusId(firstBatch, "message-7"), "message-6");
  assert.equal(getNextHistoryLimit(15, true), 25);
  assert.equal(getHistoryExpansionFocusId(secondBatch, "message-17"), "message-16");
});

test("history expansion stops when exhausted or at the bridge limit", () => {
  assert.equal(getNextHistoryLimit(5, false), undefined);
  assert.equal(getNextHistoryLimit(100, true), undefined);
  assert.equal(getNextHistoryLimit(95, true), 100);
  assert.equal(getHistoryExpansionFocusId([message("only-message", 1)], "missing-boundary"), undefined);
  assert.equal(getHistoryExpansionFocusId([message("only-message", 1)], "only-message"), undefined);
});

test("a stale history snapshot keeps a sent message already received over the live socket", () => {
  const staleSnapshot = [message("older", 99)];
  const liveMessages = [message("sent-after-submit", 100)];

  const result = mergeHistorySnapshot(staleSnapshot, liveMessages, "chat");

  assert.deepEqual(result.map((item) => item.id), ["older", "sent-after-submit"]);
});

test("history reconciliation avoids duplicates and ignores live messages from other chats", () => {
  const snapshot = [message("already-loaded", 100)];
  const liveMessages = [
    message("already-loaded", 100),
    message("other-chat-message", 101, "other-chat")
  ];

  const result = mergeHistorySnapshot(snapshot, liveMessages, "chat");

  assert.deepEqual(result.map((item) => item.id), ["already-loaded"]);
});

test("live ACK and reaction updates survive a stale history snapshot", () => {
  const cache = new RecentLiveMessageCache();
  cache.setSession("bridge-session-a");
  cache.remember(message("sent-message", 100));
  cache.update("sent-message", (existing) => ({ ...existing, ack: 3 }));
  cache.update("sent-message", (existing) => ({ ...existing, reaction: "❤️", reactions: ["❤️"] }));

  const result = mergeHistorySnapshot([message("older", 99)], cache.values(), "chat");
  const sent = result.find((item) => item.id === "sent-message");
  assert.equal(sent?.ack, 3);
  assert.equal(sent?.reaction, "❤️");
  assert.deepEqual(sent?.reactions, ["❤️"]);
});

test("replacing the bridge session clears cached messages and invalidates old history requests", () => {
  const cache = new RecentLiveMessageCache();
  cache.setSession("bridge-session-a");
  cache.remember(message("old-session-message", 100));
  const requestSessionId = cache.sessionId;

  assert.equal(cache.setSession("bridge-session-b"), true);
  assert.equal(cache.isCurrentSession(requestSessionId), false);
  assert.deepEqual(mergeHistorySnapshot([], cache.values(), "chat"), []);
});

test("adopting a session after live events preserves them and invalidates unknown-session history", () => {
  const cache = new RecentLiveMessageCache();
  const requestSessionId = cache.sessionId;
  cache.remember(message("arrived-before-session-frame", 100));

  cache.setSession("bridge-session-a");

  assert.equal(cache.isCurrentSession(requestSessionId), false);
  assert.deepEqual(
    mergeHistorySnapshot([], cache.values(), "chat").map((item) => item.id),
    ["arrived-before-session-frame"]
  );
});

test("session refresh loading stays owned by the replacement request", () => {
  const lifecycle = new HistoryRequestLifecycle();
  const oldRequest = lifecycle.begin();
  let loading = true;

  lifecycle.invalidate();
  const replacementRequest = lifecycle.begin();
  if (lifecycle.isCurrent(oldRequest)) loading = false;
  assert.equal(loading, true, "the aborted old request must not clear the replacement spinner");

  if (lifecycle.isCurrent(replacementRequest)) loading = false;
  assert.equal(loading, false, "the replacement request clears loading when it settles");
});
