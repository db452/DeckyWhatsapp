import assert from "node:assert/strict";
import { test } from "node:test";
import { createMessageYPressHandler, getMessageYAction } from "./message-actions";
import type { IncomingMessage } from "./types/message";

function makeMessage(media?: IncomingMessage["media"]): IncomingMessage {
  return {
    id: "message-1",
    chatId: "chat-1",
    chatName: "Chat",
    sender: "Sender",
    body: "Caption",
    timestamp: 1,
    fromMe: false,
    media
  };
}

test("Y has no action for images or unsupported media", () => {
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "data:image/jpeg;base64,AA==", kind: "image", mimetype: "image/jpeg" })), undefined);
  assert.equal(getMessageYAction(makeMessage()), undefined);
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "data:video/mp4;base64,AA==", kind: "gif", mimetype: "video/mp4" })), undefined);
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "data:image/gif;base64,AA==", kind: "image", mimetype: "image/gif" })), undefined);
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "", kind: "image", mimetype: "image/jpeg" })), undefined);
});

test("Y keeps audio on the existing play/pause action", () => {
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "data:audio/ogg;base64,AA==", kind: "audio", mimetype: "audio/ogg" })), "toggle-audio");
});

test("one Y press routes to exactly one audio action", () => {
  let actions = 0;
  const pressY = createMessageYPressHandler({
    isTextEntryFocused: () => false,
    isReplyInputActive: () => false,
    activateMessage: () => { actions++; return true; }
  });

  assert.equal(pressY("audio-message"), true);
  assert.equal(actions, 1);
});

test("Y press is suppressed while text entry or reply input is active", () => {
  let actions = 0;
  const pressY = createMessageYPressHandler({
    isTextEntryFocused: () => true,
    isReplyInputActive: () => false,
    activateMessage: () => { actions++; return true; }
  });
  assert.equal(pressY("audio-message"), false);

  const pressYWhileReplying = createMessageYPressHandler({
    isTextEntryFocused: () => false,
    isReplyInputActive: () => true,
    activateMessage: () => { actions++; return true; }
  });
  assert.equal(pressYWhileReplying("audio-message"), false);
  assert.equal(actions, 0);
});
