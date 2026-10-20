import assert from "node:assert/strict";
import test from "node:test";

test("production provider preserves bootstrap, retry, payload, cancellation, and event lifecycle behavior", async () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const oldWindow = globals.window;
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  const calls: { url: string; init?: RequestInit }[] = [];
  const rpcCalls: unknown[][] = [];
  const socketUrls: string[] = [];
  let tokenNumber = 0;
  let messageResponseNumber = 0;
  let hangNextFetch = false;
  const sockets: StubSocket[] = [];
  class StubSocket {
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor(url: string) { socketUrls.push(url); sockets.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globals.window = { __DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit: {
    connect() { return { _version: 2, toaster: { toast() {} }, call(...args: unknown[]) { rpcCalls.push(args); } }; }
  } };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/bootstrap")) return new Response(JSON.stringify({ token: `controlled-${++tokenNumber}` }), { status: 200 });
    if (url.endsWith("/messages") && messageResponseNumber++ === 0) return new Response("unauthorized", { status: 401 });
    if (hangNextFetch) { hangNextFetch = false; return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }); }
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };
  globalThis.WebSocket = StubSocket as unknown as typeof WebSocket;
  try {
    test.mock.module("@decky/api", { exports: { call: (...args: unknown[]) => { rpcCalls.push(args); } } });
    const { provider } = await import("./production-provider");
    provider.configure("http://127.0.0.1:8787");
    const sent = await provider.request("send", { chatId: "fabricated-id", body: "payload regression", quotedMessageId: "quoted-id" });
    assert.equal(sent.ok, true);
    const post = calls.filter((call) => call.url.endsWith("/messages")).at(-1)!;
    assert.equal(new Headers(post.init?.headers).get("Authorization"), "Bearer controlled-2");
    assert.deepEqual(JSON.parse(String(post.init?.body)), { chatId: "fabricated-id", body: "payload regression", quotedMessageId: "quoted-id" });
    assert.equal(calls.filter((call) => call.url.endsWith("/bootstrap")).length, 2);

    provider.configure("http://127.0.0.1:8787");
    const cancelController = new AbortController();
    hangNextFetch = true;
    const cancelPromise = provider.request("health", {}, cancelController.signal);
    await new Promise((resolve) => setImmediate(resolve));
    cancelController.abort();
    await assert.rejects(cancelPromise, { name: "AbortError" });

    let opened = 0;
    let closed = 0;
    let errors = 0;
    const events: unknown[] = [];
    const subscription = provider.subscribe((event) => events.push(event), () => { opened += 1; }, () => { errors += 1; }, () => { closed += 1; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sockets.length, 1);
    const socket = sockets[0]!;
    socket.readyState = StubSocket.OPEN;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "status", status: "ready", sessionId: "test-session" }) });
    socket.onmessage?.({ data: "malformed event" });
    assert.equal(opened, 1);
    assert.equal(events.length, 1);
    assert.equal(errors, 1);
    assert.match(socketUrls[0]!, /^ws:\/\/127\.0\.0\.1:8787\/events\?token=/);
    socket.onclose?.();
    assert.equal(closed, 1);
    subscription.close();
    assert.deepEqual(rpcCalls, []);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
    globals.window = oldWindow;
  }
});
