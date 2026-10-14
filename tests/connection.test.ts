import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { connectSocket, fetchWithTimeout } from "../decky-plugin/src/connection.ts";

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

test("fetch timeout aborts a stalled request", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(fetchWithTimeout("http://localhost", {}, 1), /aborted/);
});
