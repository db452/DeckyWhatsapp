// Unit tests for user-facing connection labels; no Deck or bridge is contacted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginConnectionSession, getConnectionHeadline, getConnectionToggleLabel, getConnectionWarning, runResumeRecovery } from "../decky-plugin/src/connection-state.ts";

test("connection control is a simple local start or stop toggle", () => {
  assert.equal(getConnectionToggleLabel(false), "Start");
  assert.equal(getConnectionToggleLabel(true), "Stop this Deck");
});

test("suspend recovery runs only while the Deck-side connection is enabled", () => {
  let recoveries = 0;
  assert.equal(runResumeRecovery(false, () => { recoveries++; }), false);
  assert.equal(recoveries, 0);
  assert.equal(runResumeRecovery(true, () => { recoveries++; }), true);
  assert.equal(recoveries, 1);
});

test("resume stays gated until the current plugin session is explicitly started", () => {
  const session = createPluginConnectionSession();
  assert.equal(session.isEnabled(), false);
  let recoveries = 0;
  runResumeRecovery(session.isEnabled(), () => { recoveries++; });
  assert.equal(recoveries, 0);
  session.setEnabled(true);
  assert.equal(session.isEnabled(), true);
  session.setEnabled(false);
  assert.equal(session.isEnabled(), false);
});

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
