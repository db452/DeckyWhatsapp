import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotificationIdCache } from "../decky-plugin/src/notifications/notification-id-cache.ts";

test("notification ID cache detects recently seen IDs and evicts the oldest at its limit", () => {
  const cache = createNotificationIdCache(2);
  assert.equal(cache.has("one"), false);

  cache.remember("one");
  cache.remember("two");
  assert.equal(cache.has("one"), true);
  assert.equal(cache.has("two"), true);

  cache.remember("three");
  assert.equal(cache.has("one"), false);
  assert.equal(cache.has("two"), true);
  assert.equal(cache.has("three"), true);
});

test("remembering a duplicate ID does not move it behind newer IDs", () => {
  const cache = createNotificationIdCache(2);
  cache.remember("one");
  cache.remember("two");
  cache.remember("one");
  cache.remember("three");

  assert.equal(cache.has("one"), false);
  assert.equal(cache.has("two"), true);
});

test("notification ID cache requires a positive integer limit", () => {
  assert.throws(() => createNotificationIdCache(0), RangeError);
  assert.throws(() => createNotificationIdCache(1.5), RangeError);
});
