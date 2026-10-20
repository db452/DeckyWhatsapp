// Unit tests for contact timestamp formatting in the local timezone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatChatTimestamp } from "../decky-plugin/src/messages/format.ts";

test("contact timestamps use local time for today and Yesterday for the prior day", () => {
  const now = new Date(2026, 9, 15, 17, 0);
  const today = new Date(2026, 9, 15, 14, 35).getTime() / 1000;
  const yesterday = new Date(2026, 9, 14, 23, 59).getTime() / 1000;
  assert.equal(formatChatTimestamp(today, now), new Date(today * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  assert.equal(formatChatTimestamp(yesterday, now), "Yesterday");
});

test("contact timestamps use a short locale date for older messages and omit invalid values", () => {
  const now = new Date(2026, 9, 15, 17, 0);
  const older = new Date(2026, 9, 10, 12, 0).getTime() / 1000;
  assert.equal(formatChatTimestamp(older, now), new Date(older * 1000).toLocaleDateString([], { month: "numeric", day: "numeric" }));
  assert.equal(formatChatTimestamp(undefined, now), "");
  assert.equal(formatChatTimestamp(Number.NaN, now), "");
  assert.equal(formatChatTimestamp(0, now), "");
});
