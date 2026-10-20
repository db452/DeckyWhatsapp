import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationSession } from "./notification-session";

test("notification session rejects events while notification, Deck connection, or socket is inactive", () => {
  const session = createNotificationSession();
  assert.equal(session.accepts(100, true), false, "an unopened socket has no active session watermark");

  session.open(100_000);
  assert.equal(session.accepts(100, false), false, "disabled notifications or Deck connection suppress events");
  session.close();
  assert.equal(session.accepts(100, true), false, "a closed socket is inactive");
});

test("notification session filters historical events delivered after the socket opens", () => {
  const session = createNotificationSession();
  session.open(100_999);

  assert.equal(session.accepts(100, true), false, "second-precision timestamps before the session are stale");
  assert.equal(session.accepts(101, true), true, "events at the first unambiguously current second are accepted");
  assert.equal(session.accepts(undefined, true), false);
  assert.equal(session.accepts(Number.NaN, true), false);
  assert.equal(session.accepts(Number.POSITIVE_INFINITY, true), false);
  assert.equal(session.accepts(100.5, true), false, "unexpected fractional timestamps fail closed");
});

test("notification session accepts new active-session messages", () => {
  const session = createNotificationSession();
  session.open(200_000);

  assert.equal(session.accepts(200, true), true);
  assert.equal(session.accepts(201, true), true);
});

test("close and reconnect replace the watermark so backlog from the old session stays silent", () => {
  const session = createNotificationSession();
  session.open(300_000);
  assert.equal(session.accepts(300, true), true);

  session.close();
  assert.equal(session.accepts(300, true), false);
  session.open(400_000);
  assert.equal(session.accepts(300, true), false);
  assert.equal(session.accepts(399, true), false);
  assert.equal(session.accepts(400, true), true);
});
