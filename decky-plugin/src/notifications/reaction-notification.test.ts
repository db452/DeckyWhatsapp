import assert from "node:assert/strict";
import test from "node:test";
import type { BridgeEvent } from "../providers/provider";
import { getReactionNotification } from "./reaction-notification";

const validReaction: BridgeEvent = {
  type: "reaction",
  chatId: "mock-chat",
  messageId: "mock-own-message",
  emoji: "🌱",
  fromMe: false,
  reactionId: "mock-reaction-1",
  actorId: "mock-actor",
  actorIsMe: false,
  parentFromMe: true,
  timestamp: 1_797_000_000
};

test("only a complete incoming reaction to the user's own message is notification eligible", () => {
  const expected = {
    id: "mock-chat:mock-reaction-1",
    timestamp: 1_797_000_000,
    emoji: "🌱"
  };
  assert.deepEqual(getReactionNotification(validReaction), expected);
  assert.deepEqual(getReactionNotification({ ...validReaction, actorId: undefined }), expected);

  const rejected: BridgeEvent[] = [
    { ...validReaction, fromMe: true, actorIsMe: true },
    { ...validReaction, actorId: undefined, actorIsMe: undefined },
    { ...validReaction, parentFromMe: false },
    { ...validReaction, emoji: "" },
    { ...validReaction, reactionId: undefined },
    { ...validReaction, timestamp: undefined },
    { ...validReaction, timestamp: Number.NaN },
    { ...validReaction, timestamp: 1_797_000_000.5 },
    { ...validReaction, chatId: "" },
    { ...validReaction, messageId: "" }
  ];
  for (const event of rejected) assert.equal(getReactionNotification(event), undefined);
});
