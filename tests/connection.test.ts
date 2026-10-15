// Exercise socket and fetch helpers with local mocks; these tests do not contact a Deck.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { connectSocket, createQueuedRequest, fetchWithTimeout } from "../decky-plugin/src/connection.ts";

test("a ready-state refresh queues behind a failing initial contacts request", async () => {
  let attempt = 0;
  let releaseFirst!: () => void;
  const firstRequest = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const loadContacts = createQueuedRequest(async () => {
    attempt += 1;
    if (attempt === 1) {
      await firstRequest;
      throw new Error("WhatsApp is not ready yet");
    }
  });

  const initialLoad = loadContacts();
  await setImmediate();
  const readyEventLoad = loadContacts();
  releaseFirst();
  await Promise.all([initialLoad, readyEventLoad]);
  assert.equal(attempt, 2);
});

function fakeSockets(t: TestContext) {
  const original = globalThis.WebSocket;
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    closed = false;
    onopen?: () => void;
    onclose?: () => void;
    onerror?: (error: unknown) => void;
    onmessage?: (event: { data: string }) => void;
    constructor(_url: string) { Socket.instances.push(this); }
    close() { this.closed = true; this.onclose?.(); }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  t.after(() => { globalThis.WebSocket = original; });
  return Socket;
}

test("a failed bootstrap retries without reopening the plugin", { timeout: 2000 }, async (t) => {
  const Socket = fakeSockets(t);
  let attempts = 0;
  let retryReached!: () => void;
  const retried = new Promise<void>((resolve) => { retryReached = resolve; });
  const connection = connectSocket({
    url: async () => {
      if (++attempts === 1) throw new Error("bridge offline");
      retryReached();
      return "ws://localhost/events";
    },
    onMessage: () => {},
    retryDelay: 0
  });
  t.after(() => connection.close());
  await retried;
  await setImmediate();
  assert.equal(attempts, 2);
  assert.equal(Socket.instances.length, 1);
});

test("stopping during bootstrap prevents a late socket from opening", async (t) => {
  const Socket = fakeSockets(t);
  let finish!: (url: string) => void;
  const connection = connectSocket({
    url: () => new Promise((resolve) => { finish = resolve; }),
    onMessage: () => assert.fail("stopped connection received a message")
  });
  connection.close();
  finish("ws://localhost/events");
  await setImmediate();
  assert.equal(Socket.instances.length, 0);
});

test("stopping an open socket ignores late events and closes it", async (t) => {
  const Socket = fakeSockets(t);
  let messages = 0;
  const connection = connectSocket({ url: async () => "ws://localhost/events", onMessage: () => { messages++; } });
  await setImmediate();
  const socket = Socket.instances[0];
  socket.readyState = 1;
  socket.onopen?.();
  assert.equal(connection.connected, true);
  socket.onmessage?.({ data: "before" });
  connection.close();
  socket.onmessage?.({ data: "after" });
  assert.equal(messages, 1);
  assert.equal(socket.closed, true);
  assert.equal(connection.connected, false);
});

test("a closed event socket retries and can reconnect", { timeout: 2000 }, async (t) => {
  const Socket = fakeSockets(t);
  let opened = 0;
  const reconnected = new Promise<void>((resolve) => {
    const connection = connectSocket({
      url: async () => "ws://localhost/events",
      onMessage: () => {},
      onOpen: () => { if (++opened === 2) resolve(); },
      retryDelay: 0
    });
    t.after(() => connection.close());
  });
  await setImmediate();
  const first = Socket.instances[0];
  first.readyState = 1;
  first.onopen?.();
  first.onclose?.();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = Socket.instances[1];
  assert.ok(second);
  second.readyState = 1;
  second.onopen?.();
  await reconnected;
  assert.equal(Socket.instances.length, 2);
  assert.equal(opened, 2);
});

test("fetch timeout aborts a stalled request", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(fetchWithTimeout("http://localhost", {}, 1), /aborted/);
});
