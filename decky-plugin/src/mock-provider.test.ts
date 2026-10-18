import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { act, create } from "react-test-renderer";
import { provider } from "./mock-provider";
import { createMockProviderLifecycle } from "./mock-provider-lifecycle";
import { mergeHistorySnapshot, RecentLiveMessageCache } from "./history";

const repositoryRoot = process.cwd();
let networkAttempts = 0;

function installIsolatedBrowserStubs(): () => void {
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  const oldWindow = (globalThis as { window?: unknown }).window;
  const values = new Map<string, string>();
  (globalThis as { window?: unknown }).window = { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } };
  globalThis.fetch = async () => { networkAttempts += 1; throw new Error("Network access is blocked in this test"); };
  globalThis.WebSocket = class { constructor() { networkAttempts += 1; throw new Error("WebSocket is blocked in this test"); } } as unknown as typeof WebSocket;
  return () => {
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
    (globalThis as { window?: unknown }).window = oldWindow;
  };
}

async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string, relative = ""): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      const name = join(relative, entry.name).replace(/\\/g, "/");
      if (entry.isDirectory()) await visit(child, name);
      else { hash.update(name); hash.update(await readFile(child)); }
    }
  }
  try { await visit(root); } catch { hash.update("missing"); }
  return hash.digest("hex");
}

test("mock mutating actions change only local fabricated state and never open transport", async () => {
  const restore = installIsolatedBrowserStubs();
  try {
    provider.reset();
    // Mock operations work without bridge configuration and remain local if a caller tries to override it.
    assert.equal((await provider.request("health")).ok, true);
    provider.configure("http://127.0.0.1:8787");
    assert.equal(provider.variant, "mock");
    const chats = await provider.request("chats");
    const chatList = (await chats.json() as { chats: { chatId: string }[] }).chats;
    assert.ok(chatList.some((chat) => chat.chatId.startsWith("mock-")));
    const chatId = "mock-contact-ava";
    const sent = await provider.request("send", { chatId, body: "local mock only", quotedMessageId: "mock-ava-1" });
    assert.equal(sent.ok, true);
    const history = await provider.request("history", { chatId });
    let messages = (await history.json() as { messages: { id: string; body: string; reaction?: string }[] }).messages;
    const created = messages.find((message) => message.body === "local mock only")!;
    assert.ok(created.id.startsWith("mock-out-"));
    assert.equal((await provider.request("react", { chatId, messageId: created.id, emoji: "🌱" })).ok, true);
    assert.equal(await provider.editMockMessage(chatId, created.id, "edited mock only"), true);
    assert.equal((await provider.request("delete", { chatId, messageId: created.id })).ok, true);
    messages = (await (await provider.request("history", { chatId })).json() as { messages: typeof messages }).messages;
    assert.equal(messages.find((message) => message.id === created.id)?.body, "[Message deleted]");
    provider.storageSet("enabled", "true");
    provider.storageSet("notifications-enabled", "true");
    assert.equal(provider.storageGet("enabled"), "true");
    provider.reset();
    assert.equal(provider.storageGet("enabled"), "false");
    assert.equal(provider.storageGet("notifications-enabled"), "true");
    assert.equal(networkAttempts, 0);
  } finally { restore(); provider.reset(); }
});

test("mock notifications are local and subscription cleanup is idempotent", async () => {
  const restore = installIsolatedBrowserStubs();
  try {
    provider.reset();
    const received: string[] = [];
    const onEvent = (event: Parameters<Parameters<typeof provider.subscribe>[0]>[0]) => {
      if (event.type === "message") received.push(event.message.id);
    };
    const first = provider.subscribe(onEvent, () => {}, () => {}, () => {});
    const second = provider.subscribe(onEvent, () => {}, () => {}, () => {});
    await new Promise((resolve) => setImmediate(resolve));
    provider.simulateIncoming();
    assert.equal(received.length, 2);
    first.close(); first.close();
    provider.simulateIncoming();
    assert.equal(received.length, 3);
    assert.equal(first.connected, false);
    second.close();
    provider.simulateIncoming();
    assert.equal(received.length, 3);
    assert.equal(networkAttempts, 0);
  } finally { restore(); provider.reset(); }
});

test("mock errors, session switching, and unknown operations fail closed", async () => {
  const restore = installIsolatedBrowserStubs();
  try {
    provider.reset();
    const firstHealth = await provider.request("health");
    assert.equal((await firstHealth.json() as { sessionId: string }).sessionId, "mock-session-alpha");
    provider.switchSession();
    const secondHealth = await provider.request("health");
    assert.equal((await secondHealth.json() as { sessionId: string }).sessionId, "mock-session-beta");
    provider.simulateError();
    assert.equal((await provider.request("chats")).ok, false);
    provider.simulateReconnect();
    assert.equal((await provider.request("unknown-operation" as never)).status, 400);
    assert.equal(networkAttempts, 0);
  } finally { restore(); provider.reset(); }
});

test("secondary-session view-once fixtures contain no media payloads or URLs", async () => {
  const response = await provider.request("history", { chatId: "mock-session-beta-contact", limit: 10 });
  const messages = (await response.json() as { messages: { id: string; body: string; viewOnce?: boolean; mediaKind?: string; media?: unknown; image?: unknown }[] }).messages;
  const fixtures = messages.filter((message) => message.id.startsWith("mock-beta-view-"));
  assert.deepEqual(fixtures.map((message) => message.id), [
    "mock-beta-view-photo", "mock-beta-view-video", "mock-beta-view-audio"
  ]);
  assert.ok(fixtures.every((message) => message.viewOnce));
  assert.equal(fixtures[0]?.mediaKind, "image");
  assert.equal(fixtures[1]?.mediaKind, undefined, "video uses only the view-once flag and placeholder body");
  assert.equal(fixtures[2]?.mediaKind, "audio");
  assert.ok(fixtures.every((message) => /placeholder/i.test(message.body)));
  assert.ok(fixtures.every((message) => message.media === undefined && message.image === undefined));
});

test("mock paging, empty chat, abortable delay, targeted send/media failures, and recovery are deterministic", async () => {
  const restore = installIsolatedBrowserStubs();
  try {
    provider.reset();
    const firstPage = await provider.request("history", { chatId: "mock-group-garden", limit: 5 });
    const page = await firstPage.json() as { messages: { id: string }[]; hasMore: boolean };
    assert.equal(page.messages.length, 5);
    assert.equal(page.messages[0]?.id, "mock-garden-4");
    assert.equal(page.hasMore, true);
    const older = await provider.request("history", { chatId: "mock-group-garden", limit: 8 });
    assert.equal((await older.json() as { messages: unknown[]; hasMore: boolean }).messages.length, 8);
    const empty = await provider.request("history", { chatId: "mock-empty-conversation", limit: 5 });
    assert.deepEqual((await empty.json() as { messages: unknown[]; hasMore: boolean }), { messages: [], hasMore: false });
    assert.deepEqual(provider.searchContacts("garden").map((chat) => chat.chatId), ["mock-group-garden"]);
    assert.equal(provider.searchContacts("not a fabricated contact").length, 0);

    provider.simulateDelay(1000);
    const abort = new AbortController();
    const delayed = provider.request("chats", {}, abort.signal);
    abort.abort();
    await assert.rejects(delayed, { name: "AbortError" });

    provider.simulateSendFailure();
    assert.equal((await provider.request("send", { chatId: "mock-contact-ava", body: "fails locally" })).ok, false);
    assert.equal((await provider.request("send", { chatId: "mock-contact-ava", body: "next send works" })).ok, true);
    provider.simulateMediaFailure();
    const mediaFailure = await provider.request("history", { chatId: "mock-contact-ava", limit: 5 });
    const failedMedia = (await mediaFailure.json() as { messages: { id: string; image?: unknown; mediaLoadState?: string }[] }).messages.find((message) => message.id === "mock-ava-2");
    assert.equal(failedMedia?.image, undefined);
    assert.equal(failedMedia?.mediaLoadState, "unavailable");
    const retryMedia = await provider.request("history", { chatId: "mock-contact-ava", limit: 5 });
    assert.ok((await retryMedia.json() as { messages: { id: string; image?: unknown }[] }).messages.find((message) => message.id === "mock-ava-2")?.image);

    provider.simulateError();
    assert.equal((await provider.request("health")).ok, false);
    provider.simulateReconnect();
    assert.equal((await provider.request("health")).ok, true);

    const eventIds: string[] = [];
    const connection = provider.subscribe((event) => { if (event.type === "message") eventIds.push(event.message.id); }, () => {}, () => {}, () => {});
    await new Promise((resolve) => setImmediate(resolve));
    provider.simulateIncoming();
    const firstEpochId = eventIds[0];
    connection.close();
    provider.reset();
    const second = provider.subscribe((event) => { if (event.type === "message") eventIds.push(event.message.id); }, () => {}, () => {}, () => {});
    await new Promise((resolve) => setImmediate(resolve));
    provider.simulateIncoming();
    second.close();
    assert.notEqual(eventIds[1], firstEpochId);
    assert.equal(networkAttempts, 0);
  } finally { restore(); provider.reset(); }
});

test("reset clears live-message reconciliation and remount keeps one fresh listener", async () => {
  const restore = installIsolatedBrowserStubs();
  const lifecycle = createMockProviderLifecycle(provider);
  const cache = new RecentLiveMessageCache();
  const observed: string[] = [];
  const mount = () => lifecycle.subscribe((event) => {
    if (event.type === "status" && event.sessionId) cache.setSession(event.sessionId);
    if (event.type === "message") { cache.remember(event.message); observed.push(event.message.id); }
  }, () => {}, () => {}, () => {});
  try {
    provider.reset();
    const first = mount();
    await new Promise((resolve) => setImmediate(resolve));
    await provider.request("send", { chatId: "mock-contact-ava", body: "discard after reset" });
    provider.simulateIncoming();
    assert.equal(lifecycle.activeSubscriptions, 1);
    assert.ok([...cache.values()].some((message) => message.body === "discard after reset"));
    const oldIncomingId = observed.at(-1);

    lifecycle.reset();
    cache.reset();
    first.close();
    first.close();
    assert.equal(lifecycle.activeSubscriptions, 0);
    assert.equal(cache.sessionId, "");

    const second = mount();
    await new Promise((resolve) => setImmediate(resolve));
    await provider.request("health");
    provider.simulateIncoming();
    const firstFreshIncomingId = observed[observed.length - 1];
    provider.simulateIncoming();
    const secondFreshIncomingId = observed[observed.length - 1];
    assert.notEqual(firstFreshIncomingId, secondFreshIncomingId);
    provider.simulateReconnect();
    const loaded = await provider.request("history", { chatId: "mock-group-garden", limit: 50 });
    const snapshot = (await loaded.json() as { messages: { id: string; body: string }[] }).messages;
    const reconciled = mergeHistorySnapshot(snapshot, cache.values(), "mock-group-garden");
    assert.equal(reconciled.some((message) => message.body === "discard after reset"), false);
    assert.equal(reconciled.filter((message) => message.id === oldIncomingId).length, 0);
    assert.equal(reconciled.filter((message) => message.id === firstFreshIncomingId).length, 1);
    assert.equal(reconciled.filter((message) => message.id === secondFreshIncomingId).length, 1);
    assert.equal(lifecycle.activeSubscriptions, 1);
    assert.equal(observed.filter((id) => id === observed.at(-1)).length, 1);
    second.close();
    assert.equal(lifecycle.activeSubscriptions, 0);
    assert.equal(networkAttempts, 0);
  } finally { lifecycle.reset(); cache.reset(); restore(); provider.reset(); }
});

test("edits and deletes recompute mock previews without changing an older-message preview", async () => {
  const restore = installIsolatedBrowserStubs();
  try {
    provider.reset();
    const readChat = async (chatId: string) => (await (await provider.request("chats")).json() as { chats: { chatId: string; lastMessage: string; timestamp: number }[] }).chats.find((chat) => chat.chatId === chatId)!;
    const gardenBefore = await readChat("mock-group-garden");
    assert.equal(await provider.editMockMessage("mock-group-garden", "mock-garden-5", "Edited older garden message"), true);
    assert.equal((await readChat("mock-group-garden")).lastMessage, gardenBefore.lastMessage);
    assert.equal((await provider.request("delete", { chatId: "mock-group-garden", messageId: "mock-garden-2" })).ok, true);
    assert.deepEqual(await readChat("mock-group-garden"), gardenBefore);

    const sent = await provider.request("send", { chatId: "mock-contact-ava", body: "Latest editable mock" });
    const messageId = (await sent.json() as { messageId: string }).messageId;
    const previewBeforeEdit = await readChat("mock-contact-ava");
    assert.equal(await provider.editMockMessage("mock-contact-ava", messageId, "Latest edited mock"), true);
    assert.deepEqual(await readChat("mock-contact-ava"), { ...previewBeforeEdit, lastMessage: "Latest edited mock" });
    assert.equal((await provider.request("delete", { chatId: "mock-contact-ava", messageId })).ok, true);
    assert.equal((await readChat("mock-contact-ava")).lastMessage, "[Message deleted]");
  } finally { restore(); provider.reset(); }
});

test("mock plugin entrypoint initializes and dismounts offline with isolated Decky/storage hooks", async () => {
  const oldWindow = (globalThis as { window?: unknown }).window;
  const oldReact = (globalThis as { SP_REACT?: unknown }).SP_REACT;
  const oldJsx = (globalThis as { SP_JSX?: unknown }).SP_JSX;
  const oldUi = (globalThis as { DFL?: unknown }).DFL;
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  const originalValues = new Map<string, string>([["decky-whatsapp-enabled", "production-sentinel"]]);
  const rpcCalls: unknown[][] = [];
  const identities: string[] = [];
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => originalValues.get(key) ?? null,
      setItem: (key: string, value: string) => originalValues.set(key, value),
      removeItem: (key: string) => originalValues.delete(key)
    },
    __DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit: {
      connect(_version: number, name: string) {
        identities.push(name);
        return { _version: 2, toaster: { toast() {} }, call(...args: unknown[]) { rpcCalls.push(args); } };
      }
    }
  };
  (globalThis as { SP_REACT?: unknown }).SP_REACT = React;
  (globalThis as { SP_JSX?: unknown }).SP_JSX = { Fragment, jsx, jsxs };
  const passthrough = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement("div", props, children);
  const ButtonItem = ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => React.createElement("button", { onClick }, children);
  const ui = {
    ButtonItem,
    Focusable: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>((props, ref) => React.createElement("div", { ref }, props.children)),
    PanelSection: passthrough,
    PanelSectionRow: passthrough,
    TextField: ({ label, value }: { label?: string; value?: string }) => React.createElement("input", { "aria-label": label, value, readOnly: true }),
    Router: { MainRunningApp: false },
  };
  (globalThis as { DFL?: unknown }).DFL = ui;
  globalThis.fetch = async () => { networkAttempts += 1; throw new Error("Network disabled before mock entrypoint import"); };
  globalThis.WebSocket = class { constructor() { networkAttempts += 1; throw new Error("WebSocket disabled before mock entrypoint import"); } } as unknown as typeof WebSocket;
  try {
    const { default: initialize } = await import("../../artifacts/decky-whatsapp-mock/dist/index.js?isolated-runtime");
    const first = initialize();
    assert.equal(first.name, "Decky WhatsApp MOCK");
    const html = renderToStaticMarkup(first.content as React.ReactElement);
    assert.match(html, /MOCK \/ OFFLINE/);
    assert.match(html, /decky-provider-ready/);
    first.onDismount?.();
    first.onDismount?.();
    const second = initialize();
    second.onDismount?.();
    assert.ok(identities.length >= 1);
    assert.ok(identities.every((identity) => identity === "Decky WhatsApp MOCK"));
    assert.equal(originalValues.get("decky-whatsapp-enabled"), "production-sentinel");
    assert.equal(originalValues.get("decky-whatsapp-mock-enabled"), "false");
    assert.deepEqual(rpcCalls, []);
    assert.equal(networkAttempts, 0);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
    (globalThis as { window?: unknown }).window = oldWindow;
    (globalThis as { SP_REACT?: unknown }).SP_REACT = oldReact;
    (globalThis as { SP_JSX?: unknown }).SP_JSX = oldJsx;
    (globalThis as { DFL?: unknown }).DFL = oldUi;
  }
});

test("mounted mock panel runs effects and handlers offline and cleans up across remounts", async () => {
  const oldWindow = (globalThis as { window?: unknown }).window;
  const oldDocument = (globalThis as { document?: unknown }).document;
  const oldCss = (globalThis as { CSS?: unknown }).CSS;
  const oldReact = (globalThis as { SP_REACT?: unknown }).SP_REACT;
  const oldJsx = (globalThis as { SP_JSX?: unknown }).SP_JSX;
  const oldUi = (globalThis as { DFL?: unknown }).DFL;
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  const oldSteamClient = (globalThis as { SteamClient?: unknown }).SteamClient;
  const oldApiInit = (globalThis as { __DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit?: unknown })
    .__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
  const productionSentinel = "preserve-production-setting";
  const stored = new Map<string, string>([["decky-whatsapp-enabled", productionSentinel]]);
  const storageKeys: string[] = [];
  const rpcCalls: unknown[][] = [];
  const apiNames: string[] = [];
  const networkUrls: string[] = [];
  const intervals = new Map<number, ReturnType<typeof setInterval>>();
  const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
  let nextTimerId = 1;
  let resumeUnregistered = 0;
  let controllerUnregistered = 0;
  let controllerListener: ((controllerIndex: number, gamepadButton: number, isButtonPressed: boolean) => void) | undefined;
  const timers = {
    setInterval(callback: () => void, milliseconds: number) {
      const id = nextTimerId++;
      intervals.set(id, setInterval(callback, milliseconds));
      return id;
    },
    clearInterval(id: number) {
      const timer = intervals.get(id);
      if (timer) clearInterval(timer);
      intervals.delete(id);
    },
    setTimeout(callback: () => void, milliseconds: number) {
      const timer = setTimeout(() => { activeTimeouts.delete(timer); callback(); }, milliseconds);
      activeTimeouts.add(timer);
      return timer;
    },
    clearTimeout(timer: ReturnType<typeof setTimeout>) {
      clearTimeout(timer);
      activeTimeouts.delete(timer);
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      return setTimeout(() => callback(Date.now()), 0) as unknown as number;
    },
    cancelAnimationFrame(id: number) { clearTimeout(id); }
  };
  (globalThis as { window?: unknown }).window = {
    ...timers,
    localStorage: {
      getItem(key: string) { storageKeys.push(key); return stored.get(key) ?? null; },
      setItem(key: string, value: string) { storageKeys.push(key); stored.set(key, value); },
      removeItem(key: string) { storageKeys.push(key); stored.delete(key); }
    }
  };
  (globalThis as { document?: unknown }).document = {
    activeElement: null,
    body: {},
    scrollingElement: null,
    querySelector() { return null; }
  };
  (globalThis as { CSS?: unknown }).CSS = { escape(value: string) { return value; } };
  (globalThis as { SP_REACT?: unknown }).SP_REACT = React;
  (globalThis as { SP_JSX?: unknown }).SP_JSX = { Fragment, jsx, jsxs };
  const passthrough = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement("div", props, children);
  const ButtonItem = ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
    React.createElement("button", { onClick, disabled }, children);
  const TextField = ({ label, value, onChange, ...props }: { label?: string; value?: string; onChange?: (value: string) => void; [key: string]: unknown }) =>
    React.createElement("input", { "aria-label": label, value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value), ...props });
  (globalThis as { DFL?: unknown }).DFL = {
    ButtonItem,
    Focusable: React.forwardRef<HTMLDivElement, { children?: React.ReactNode; [key: string]: unknown }>((props, ref) => React.createElement("div", { ...props, ref }, props.children)),
    PanelSection: passthrough,
    PanelSectionRow: passthrough,
    TextField,
    Router: { MainRunningApp: false }
  };
  globalThis.fetch = async (input) => { networkUrls.push(String(input)); throw new Error("Network disabled in active mock panel test"); };
  globalThis.WebSocket = class { constructor(url: string) { networkUrls.push(url); throw new Error("WebSocket disabled in active mock panel test"); } } as unknown as typeof WebSocket;
  (globalThis as { SteamClient?: unknown }).SteamClient = {
    System: { RegisterForOnResumeFromSuspend() { return { unregister() { resumeUnregistered += 1; } }; } },
    Input: { RegisterForControllerInputMessages(callback: typeof controllerListener) {
      controllerListener = callback;
      return { unregister() { controllerUnregistered += 1; } };
    } }
  };
  const apiInit = {
      connect(_version: number, name: string) {
        apiNames.push(name);
        return { _version: 2, toaster: { toast() {} }, call(...args: unknown[]) { rpcCalls.push(args); } };
      }
    };
  (globalThis as { __DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit?: unknown })
    .__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit = apiInit;
  ((globalThis as { window?: { [key: string]: unknown } }).window)!
    .__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit = apiInit;

  const textOf = (node: { children: unknown[] }): string => node.children.map((child) =>
    typeof child === "string" || typeof child === "number" ? String(child)
      : child && typeof child === "object" && "children" in child ? textOf(child as { children: unknown[] }) : ""
  ).join("");
  const findButton = (renderer: ReturnType<typeof create>, label: string) => renderer.root.findAllByType("button")
    .find((button) => textOf(button as unknown as { children: unknown[] }).includes(label));
  const flush = async () => {
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
  };
  const mountPanel = (content: React.ReactElement) => create(content, {
    createNodeMock(element) {
      if (element.type !== "div") return null;
      return { ownerDocument: globalThis.document, querySelectorAll() { return []; }, querySelector() { return null; } };
    }
  });

  let renderer: ReturnType<typeof create> | undefined;
  let descriptor: { name: string; content: React.ReactElement; onDismount?: () => void } | undefined;
  try {
    const { default: initialize } = await import("../../artifacts/decky-whatsapp-mock/dist/index.js?active-react-mount");
    descriptor = initialize() as typeof descriptor;
    assert.equal(descriptor?.name, "Decky WhatsApp MOCK");
    await act(async () => { renderer = mountPanel(descriptor!.content); });
    await flush();
    const mockPanelScopes = renderer!.root.findAll((node) => node.props["data-decky-scope"] === "mock-panel");
    assert.equal(mockPanelScopes.length, 1, "the MOCK contacts controls should share one scoped CDP target");
    assert.equal(mockPanelScopes[0].props["data-decky-provider"], "mock");
    assert.equal(mockPanelScopes[0].props["data-decky-label"], "MOCK / OFFLINE");
    assert.equal(mockPanelScopes[0].props["aria-label"], "MOCK / OFFLINE");
    assert.ok(renderer!.root.findAllByType("input").some((input) => input.props["aria-label"] === "Search mock contacts"));
    assert.ok(findButton(renderer!, "Start"));

    await act(async () => { findButton(renderer!, "Settings")!.props.onClick(); });
    assert.equal(renderer!.root.findAll((node) => node.props["data-decky-scope"] === "mock-panel").length, 1,
      "the MOCK scope should persist while settings are visible");
    await act(async () => { findButton(renderer!, "Back to contacts")!.props.onClick(); });

    await act(async () => { findButton(renderer!, "Start")!.props.onClick(); });
    await flush();
    const ava = findButton(renderer!, "Ava Example");
    assert.ok(ava, "fixture contact should load after enabling the mock connection");
    await act(async () => { findButton(renderer!, "Simulate incoming message")!.props.onClick(); });
    assert.ok(findButton(renderer!, "Deterministic incoming mock"), "active provider subscription should render a fabricated incoming event");
    await act(async () => { ava!.props.onClick(); });
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 180)); });
    await flush();
    assert.ok(findButton(renderer!, "Did you see the mock album?"), "fixture history should render after opening a conversation");
    assert.equal(renderer!.root.findAll((node) => node.props["data-decky-scope"] === "mock-panel").length, 1,
      "the MOCK scope should persist while a conversation is visible");

    const fixtureMessage = findButton(renderer!, "Did you see the mock album?");
    await act(async () => { fixtureMessage!.props.onClick(); });
    const reactionButton = findButton(renderer!, "React ❤️ (X)");
    assert.ok(reactionButton, "selecting a fixture message should expose its simulated reaction action");
    await act(async () => { reactionButton!.props.onClick(); });
    await flush();
    assert.ok(renderer!.root.findAll((node) => node.props["aria-label"] === "Message reactions")
      .some((node) => textOf(node as unknown as { children: unknown[] }).includes("❤️")), "reaction handler should update the fixture message locally");

    const replyInput = renderer!.root.findAllByType("input").find((input) => input.props["aria-label"] === "Reply");
    assert.ok(replyInput, "the mounted panel should expose its reply field");
    await act(async () => { replyInput!.props.onChange({ target: { value: "Mounted-panel mock send" } }); });
    await act(async () => { findButton(renderer!, "Send reply")!.props.onClick(); });
    await flush();
    assert.ok(findButton(renderer!, "Mounted-panel mock send"), "send handler should add the fabricated message to the rendered conversation");

    await act(async () => { findButton(renderer!, "Did you see the mock album?")!.props.onClick(); });
    assert.ok(findButton(renderer!, "Reply to selected message"), "fixture selection should remain active while testing image Y");

    const imageRow = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === "mock-ava-2")
      .find((node) => typeof node.props.onKeyDown === "function");
    assert.ok(imageRow, "the fabricated image row should expose the keyboard no-op guard");
    await act(async () => { imageRow!.props.onFocusCapture(); });
    let yPrevented = false;
    let yStopped = false;
    await act(async () => { imageRow!.props.onKeyDown({ key: "y", preventDefault() { yPrevented = true; }, stopPropagation() { yStopped = true; } }); });
    assert.equal(yPrevented, true, "keyboard Y on an image should be consumed as a no-op");
    assert.equal(yStopped, true, "image Y should not bubble into Quick Access navigation");
    assert.ok(findButton(renderer!, "Mounted-panel mock send"), "image Y should leave the conversation mounted");
    assert.ok(findButton(renderer!, "Reply to selected message"), "image Y should preserve the existing reply selection");
    assert.ok(findButton(renderer!, "Back to contacts"), "image Y should not navigate back to contacts");

    await act(async () => { controllerListener?.(0, 3, true); });
    assert.ok(findButton(renderer!, "Mounted-panel mock send"), "controller Y on an image should leave the conversation mounted");
    assert.ok(findButton(renderer!, "Reply to selected message"), "controller Y on an image should preserve reply selection");
    assert.ok(findButton(renderer!, "Back to contacts"), "controller Y on an image should not navigate back to contacts");

    await act(async () => { findButton(renderer!, "Back to contacts")!.props.onClick(); });
    const secondarySession = findButton(renderer!, "Second Session — Nia");
    assert.ok(secondarySession, "the secondary-session fixture conversation should be listed");
    await act(async () => { secondarySession!.props.onClick(); });
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 180)); });
    await flush();

    const viewOnceIds = ["mock-beta-view-photo", "mock-beta-view-video", "mock-beta-view-audio"];
    for (const messageId of viewOnceIds) {
      const row = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === messageId)
        .find((node) => typeof node.props.onKeyDown === "function");
      assert.ok(row, `${messageId} should render in the active secondary-session conversation`);
      assert.match(textOf(row as unknown as { children: unknown[] }), /WhatsApp on your phone/i,
        `${messageId} should show the safe phone fallback`);
    }
    assert.equal(findButton(renderer!, "Retry media"), undefined, "view-once placeholders must not offer a media retry");
    assert.equal(renderer!.root.findAllByType("audio").length, 0, "the view-once audio placeholder must not expose a player");
    for (const messageId of viewOnceIds) {
      const row = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === messageId)
        .find((node) => typeof node.props.onKeyDown === "function")!;
      let yPreventedForMedia = false;
      await act(async () => { row.props.onKeyDown({ key: "y", preventDefault() { yPreventedForMedia = true; }, stopPropagation() {} }); });
      assert.equal(yPreventedForMedia, false, `${messageId} must not consume Y as a media action`);
    }
    assert.deepEqual(networkUrls, [], "view-once Y presses must not request media over fetch or WebSocket");

    await act(async () => { renderer!.unmount(); });
    descriptor.onDismount?.();
    renderer = undefined;
    assert.equal(intervals.size, 0, "unmount should clear the health polling interval");
    assert.ok(controllerUnregistered >= 1, "unmount should unregister controller handlers");
    assert.equal(resumeUnregistered, 1, "plugin dismount should unregister the Decky resume handler");

    descriptor = initialize() as typeof descriptor;
    await act(async () => { renderer = mountPanel(descriptor!.content); });
    await flush();
    assert.ok(findButton(renderer!, "Start"), "remount should initialize in the deliberate disabled state");
    assert.ok(renderer!.root.findAllByType("input").some((input) => input.props["aria-label"] === "Search mock contacts"));
    await act(async () => { renderer!.unmount(); });
    descriptor.onDismount?.();

    assert.ok(apiNames.length >= 1 && apiNames.every((name) => name === "Decky WhatsApp MOCK"));
    assert.deepEqual(rpcCalls, [], "mock panel must not issue Decky backend RPCs");
    assert.deepEqual(networkUrls, [], "mock panel must not use fetch or WebSocket");
    assert.ok(storageKeys.length > 0, "effects should exercise the isolated mock storage adapter");
    assert.ok(storageKeys.every((key) => key.startsWith("decky-whatsapp-mock-")), "panel storage must remain in the mock namespace");
    assert.equal(stored.get("decky-whatsapp-enabled"), productionSentinel, "production preference sentinel must remain untouched");
    assert.equal(intervals.size, 0, "final unmount should leave no polling interval");
    assert.equal(activeTimeouts.size, 0, "final unmount should leave no scheduled timeouts");
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    descriptor?.onDismount?.();
    for (const timer of intervals.values()) clearInterval(timer);
    for (const timer of activeTimeouts) clearTimeout(timer);
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
    (globalThis as { window?: unknown }).window = oldWindow;
    (globalThis as { document?: unknown }).document = oldDocument;
    (globalThis as { CSS?: unknown }).CSS = oldCss;
    (globalThis as { SP_REACT?: unknown }).SP_REACT = oldReact;
    (globalThis as { SP_JSX?: unknown }).SP_JSX = oldJsx;
    (globalThis as { DFL?: unknown }).DFL = oldUi;
    (globalThis as { SteamClient?: unknown }).SteamClient = oldSteamClient;
    (globalThis as { __DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit?: unknown })
      .__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit = oldApiInit;
  }
});

test("mock artifact has unique identity and excludes production bridge, credentials, RPC, and storage", async () => {
  const mockRoot = join(repositoryRoot, "artifacts", "decky-whatsapp-mock");
  const manifest = JSON.parse(await readFile(join(mockRoot, "plugin.json"), "utf8")) as { name: string; appkey: string };
  const productionManifest = JSON.parse(await readFile(join(repositoryRoot, "decky-plugin", "plugin.json"), "utf8")) as { name: string; appkey: string };
  assert.notEqual(manifest.name, productionManifest.name);
  assert.notEqual(manifest.appkey, productionManifest.appkey);
  assert.equal(manifest.name, "Decky WhatsApp MOCK");
  const artifactPackage = JSON.parse(await readFile(join(mockRoot, "package.json"), "utf8")) as { name: string; version: string; type: string };
  assert.deepEqual(artifactPackage, { name: "decky-whatsapp-mock", version: "1.0.0", private: true, type: "module" });
  const bundle = await readFile(join(mockRoot, "dist", "index.js"), "utf8");
  const sourceMap = await readFile(join(mockRoot, "dist", "index.js.map"), "utf8");
  const forbidden = ["127.0.0.1:8787", "/bootstrap", "voice_typing_status", "transcribe_audio", "wwebjs_auth", "decky-whatsapp-enabled", "decky-whatsapp-notification", "Authorization", "new WebSocket", "fetch(", "production-provider", "connection.ts"];
  for (const token of forbidden) {
    assert.equal(bundle.includes(token), false, `mock bundle included forbidden token ${token}`);
    assert.equal(sourceMap.includes(token), false, `mock source map included forbidden token ${token}`);
  }
  assert.match(bundle, /decky-whatsapp-mock-/);
  const backend = await readFile(join(mockRoot, "main.py"), "utf8");
  assert.doesNotMatch(backend, /whisper|voice|transcribe|credential|auth/i);
  assert.equal(networkAttempts, 0);
});

test("production build leaves mock output unchanged and retains production transport", async () => {
  const mockRoot = join(repositoryRoot, "artifacts", "decky-whatsapp-mock");
  const before = await treeDigest(mockRoot);
  const build = spawnSync(process.execPath, ["node_modules/rollup/dist/bin/rollup", "-c"], {
    cwd: join(repositoryRoot, "decky-plugin"), encoding: "utf8"
  });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  assert.equal(await treeDigest(mockRoot), before);
  const production = await readFile(join(repositoryRoot, "decky-plugin", "dist", "index.js"), "utf8");
  assert.match(production, /127\.0\.0\.1:8787/);
});
