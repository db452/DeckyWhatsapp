// Unit tests for user-facing connection labels; no Deck or bridge is contacted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getConnectionHeadline, getConnectionWarning } from "../decky-plugin/src/connection-state.ts";

test("connection headline requires healthy HTTP, WebSocket, and WhatsApp readiness", () => {
  assert.equal(getConnectionHeadline(true, "connected", "connected", "ready"), "Connected");
  assert.equal(getConnectionHeadline(true, "disconnected", "connected", "ready"), "Computer unavailable");
  assert.equal(getConnectionHeadline(true, "connected", "disconnected", "ready"), "Reconnecting");
  assert.equal(getConnectionHeadline(true, "connected", "connected", "disconnected"), "Reconnecting");
  assert.equal(getConnectionHeadline(true, "connected", "connected", "starting"), "Connecting");
  assert.equal(getConnectionHeadline(true, "connected", "connected", "qr_required"), "Authentication required");
  assert.equal(getConnectionHeadline(false, "connected", "connected", "ready"), "Disabled");
});

test("connection warnings clear only when their own connection condition recovers", () => {
  assert.equal(getConnectionWarning(true, "disconnected", "connected", "ready"), "Computer unavailable. Retrying connection…");
  assert.equal(getConnectionWarning(true, "connected", "disconnected", "ready"), "WebSocket disconnected. Reconnecting…");
  assert.equal(getConnectionWarning(true, "connected", "connected", "disconnected"), "WhatsApp disconnected. Reconnecting…");
  assert.equal(getConnectionWarning(true, "connected", "connected", "ready"), "");
  assert.equal(getConnectionWarning(false, "disconnected", "disconnected", "disconnected"), "");
});
