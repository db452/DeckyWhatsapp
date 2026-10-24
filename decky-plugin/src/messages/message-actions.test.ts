import assert from "node:assert/strict";
import { test } from "node:test";
import { createMessageYPressHandler, getMessageYAction } from "./message-actions";
import type { IncomingMessage } from "../types/message";

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

test("Y opens a loaded image in production and offline MOCK providers", () => {
  const image = makeMessage({ dataUrl: "data:image/jpeg;base64,AA==", kind: "image", mimetype: "image/jpeg" });
  assert.equal(getMessageYAction(image), "open-image");
  assert.equal(getMessageYAction(image, "mock"), "open-image");
  assert.equal(getMessageYAction({ ...image, mediaLoadState: "unavailable" }, "mock"), undefined,
    "a failed image load must not reopen the viewer even if media data is retained");
  assert.equal(getMessageYAction({ ...image, mediaLoadState: "loading" }, "mock"), undefined,
    "an image still loading must not open the viewer");
  assert.equal(getMessageYAction({ ...image, viewOnce: true }, "mock"), undefined);
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "", kind: "image", mimetype: "image/jpeg" }), "mock"), undefined);
  assert.equal(getMessageYAction({ ...image, media: undefined, image: { dataUrl: image.media!.dataUrl, filename: "fixture.jpg" } }, "mock"), "open-image");
});

test("Y has no action for unsupported media", () => {
  assert.equal(getMessageYAction(makeMessage()), undefined);
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "data:video/mp4;base64,AA==", kind: "gif", mimetype: "video/mp4" })), undefined);
});

test("Y keeps audio on the existing play/pause action", () => {
  assert.equal(getMessageYAction(makeMessage({ dataUrl: "data:audio/ogg;base64,AA==", kind: "audio", mimetype: "audio/ogg" })), "toggle-audio");
});

test("Y toggles ordinary video and keeps view-once video unsupported", () => {
  const video = makeMessage({ dataUrl: "data:video/webm;base64,GkXfo", kind: "video", mimetype: "video/webm" });
  assert.equal(getMessageYAction(video), "toggle-video");
  assert.equal(getMessageYAction({ ...video, viewOnce: true }), undefined);
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
