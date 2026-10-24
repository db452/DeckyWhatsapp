import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { act, create } from "react-test-renderer";
import { provider } from "./mock-provider";
import { createMockProviderLifecycle } from "./mock-provider-lifecycle";
import { mergeHistorySnapshot, RecentLiveMessageCache } from "../messages/history";
import { createNotificationSession } from "../notifications/notification-session";
import { ImageViewerFocusTarget } from "../components/image-viewer-focus-target";
import { handleConversationCancel, handleImageViewerFocusableCancel } from "../platform/image-viewer-cancel";

test("ImageViewerModal renders its image and focuses the modal target", async () => {
  const focusCalls: Array<{ preventScroll?: boolean }> = [];
  const animationFrames: Array<() => void> = [];
  const ownerWindow = {
    requestAnimationFrame(callback: () => void) { animationFrames.push(callback); return animationFrames.length; },
    cancelAnimationFrame() {}
  };
  const ownerDocument = { documentElement: {}, defaultView: ownerWindow };
  const originalReactGlobal = (globalThis as { React?: unknown }).React;
  (globalThis as { React?: unknown }).React = React;
  const Focusable = React.forwardRef<HTMLDivElement, { children?: React.ReactNode; [key: string]: unknown }>(
    (props, ref) => React.createElement("div", { ...props, ref }, props.children)
  );

  mock.module("react-dom", { exports: { createPortal: (children: React.ReactNode) => children } });
  mock.module("@decky/ui", { exports: {
    Focusable,
    ModalRoot: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    NavEntryPositionPreferences: { FIRST: 0 }
  } });
  try {
    const { ImageViewerModal } = await import("../components/ImageViewerModal?image-viewer-modal-test");
    const renderer = create(React.createElement(ImageViewerModal, {
      imageDataUrl: "data:image/png;base64,AA==",
      imageLabel: "MOCK fixture image",
      onClose() {}
    }), {
      createNodeMock(element) {
        if (element.type !== "div") return null;
        return {
          ownerDocument,
          isConnected: true,
          focus(options?: { preventScroll?: boolean }) { focusCalls.push(options || {}); }
        };
      }
    });
    await act(async () => {});
    assert.equal(renderer.root.findByType("img").props.src, "data:image/png;base64,AA==");
    assert.equal(renderer.root.findByType("img").props.alt, "MOCK fixture image");
    const focusable = renderer.root.findAllByType("div").find((node) => node.props.tabIndex === 0);
    assert.ok(focusable, "the actual image modal mounts its programmatically focusable Decky target");
    assert.equal(animationFrames.length, 1, "mount schedules focus on the modal target");
    await act(async () => { animationFrames[0](); });
    assert.deepEqual(focusCalls, [{ preventScroll: true }], "the modal focus target receives focus without scrolling");
    renderer.unmount();
  } finally {
    mock.restoreAll();
    (globalThis as { React?: unknown }).React = originalReactGlobal;
  }
});

const repositoryRoot = process.cwd();
let networkAttempts = 0;

test("the viewer consumes B without a raw controller listener and later B returns to contacts", () => {
  let imageViewerOpen = true;
  let closeViewerCalls = 0;
  let closeConversationCalls = 0;
  const makeEvent = () => {
    const result = { prevented: false, stopped: false };
    return {
      result,
      event: {
        preventDefault() { result.prevented = true; },
        stopPropagation() { result.stopped = true; }
      }
    };
  };
  const closeViewer = () => {
    if (!imageViewerOpen) return;
    closeViewerCalls += 1;
    imageViewerOpen = false;
  };
  const cancelConversation = (event: ReturnType<typeof makeEvent>["event"]) =>
    handleConversationCancel(event, imageViewerOpen, closeViewer, () => { closeConversationCalls += 1; });

  const whileOpen = makeEvent();
  handleImageViewerFocusableCancel(whileOpen.event, closeViewer);
  assert.deepEqual(whileOpen.result, { prevented: true, stopped: true }, "the viewer Focusable consumes B before Decky navigation can reach the conversation");
  assert.equal(closeViewerCalls, 1, "the viewer's own focused target closes the image");
  assert.equal(closeConversationCalls, 0, "closing the viewer preserves the conversation");

  // This is the late ModalRoot callback after a B release: close is idempotent,
  // and no raw B listener is needed to keep the conversation open.
  closeViewer();
  assert.equal(closeViewerCalls, 1, "a delayed modal cancel cannot close twice");
  assert.equal(closeConversationCalls, 0);

  const nextConversationBack = makeEvent();
  cancelConversation(nextConversationBack.event);
  assert.deepEqual(nextConversationBack.result, { prevented: true, stopped: true });
  assert.equal(closeConversationCalls, 1, "a later B after viewer dismissal closes the conversation normally");
});

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

test("MOCK emits a fabricated incoming reaction to one of the user's messages", async () => {
  const restore = installIsolatedBrowserStubs();
  try {
    provider.reset();
    const notificationSession = createNotificationSession();
    const sameSecondAsSessionOpen = 1_700_000_000_100;
    notificationSession.open(sameSecondAsSessionOpen);
    let received: Extract<import("./provider").BridgeEvent, { type: "reaction" }> | undefined;
    const connection = provider.subscribe((event) => {
      if (event.type === "reaction") received = event;
    }, () => {}, () => {}, () => {});
    await new Promise((resolve) => setImmediate(resolve));
    const originalNow = Date.now;
    Date.now = () => sameSecondAsSessionOpen;
    try { provider.simulateReaction(); }
    finally { Date.now = originalNow; }
    connection.close();

    assert.equal(received?.chatId, "mock-group-garden");
    assert.equal(received?.messageId, "mock-garden-2");
    assert.equal(received?.parentFromMe, true);
    assert.equal(received?.actorIsMe, false);
    assert.equal(received?.fromMe, false);
    assert.equal(received?.actorId, "mock-actor-nia");
    assert.equal(received?.emoji, "🌱");
    assert.ok(received?.reactionId);
    assert.equal(received?.timestamp, Math.ceil(sameSecondAsSessionOpen / 1000));
    assert.equal(notificationSession.accepts(received?.timestamp, true), true,
      "a simulated reaction emitted in the session-opening second must pass the current-session guard");
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
    const { default: initialize } = await import("../../../artifacts/decky-whatsapp-mock/dist/index.js?isolated-runtime");
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
  const toastCalls: Array<{ title?: string; body?: string; playSound?: boolean }> = [];
  const modalCalls: Array<{ modal: React.ReactNode; parent?: EventTarget; options?: { strTitle?: string } }> = [];
  const imageYOrder: string[] = [];
  let modalCloseCalls = 0;
  const intervals = new Map<number, ReturnType<typeof setInterval>>();
  const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
  let nextTimerId = 1;
  let resumeUnregistered = 0;
  let resumeCallback: (() => void) | undefined;
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
  let activeMockElement: { matches(selector: string): boolean; isContentEditable?: boolean } | null = null;
  let imageDomFocusCalls = 0;
  let imageBoundsCalls = 0;
  let conversationMessageQueries = 0;
  const body = {};
  const mockScrollViewport = {
    parentElement: body,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 400,
    getBoundingClientRect() { return { top: 0, height: 400 }; }
  };
  const mockWindow = {
    ...timers,
    innerHeight: 400,
    getComputedStyle(element: unknown) { return { overflowY: element === mockScrollViewport ? "auto" : "visible" }; }
  };
  const mockDocument = {
    get activeElement() { return activeMockElement; },
    body,
    scrollingElement: null,
    defaultView: mockWindow,
    querySelector() { return null; }
  };
  const messageDomElements = new Map<string, {
    dataset: { deckyMessageId: string };
    parentElement: typeof mockScrollViewport;
    ownerDocument: typeof mockDocument;
    querySelector(): { focus(): void };
    getBoundingClientRect(): { top: number; height: number };
  }>();
  const messageDomElement = (messageId: string) => {
    let element = messageDomElements.get(messageId);
    if (!element) {
      element = {
        dataset: { deckyMessageId: messageId },
        parentElement: mockScrollViewport,
        ownerDocument: mockDocument,
        querySelector() { return { focus() { if (messageId === "mock-ava-2") imageDomFocusCalls += 1; } }; },
        getBoundingClientRect() { if (messageId === "mock-ava-2") imageBoundsCalls += 1; return { top: messageId === "mock-ava-2" ? 800 : 100, height: 100 }; }
      };
      messageDomElements.set(messageId, element);
    }
    return element;
  };
  for (const messageId of ["mock-ava-1", "mock-ava-2", "mock-ava-video", "mock-ava-3"]) messageDomElement(messageId);
  (globalThis as { document?: unknown }).document = mockDocument;
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
    NavEntryPositionPreferences: { FIRST: 0, PREFERRED_CHILD: 4 },
    ModalRoot: passthrough,
    showModal(modal: React.ReactNode, parent?: EventTarget, options?: { strTitle?: string }) {
      imageYOrder.push("open");
      modalCalls.push({ modal, parent, options });
      return { Close() { modalCloseCalls += 1; }, Update() {} };
    },
    Focusable: React.forwardRef<HTMLDivElement, { children?: React.ReactNode; [key: string]: unknown }>((props, ref) => React.createElement("div", { ...props, ref }, props.children)),
    PanelSection: passthrough,
    PanelSectionRow: passthrough,
    TextField,
    Router: { MainRunningApp: false }
  };
  globalThis.fetch = async (input) => { networkUrls.push(String(input)); throw new Error("Network disabled in active mock panel test"); };
  globalThis.WebSocket = class { constructor(url: string) { networkUrls.push(url); throw new Error("WebSocket disabled in active mock panel test"); } } as unknown as typeof WebSocket;
  (globalThis as { SteamClient?: unknown }).SteamClient = {
    System: { RegisterForOnResumeFromSuspend(callback: () => void) { resumeCallback = callback; return { unregister() { resumeUnregistered += 1; } }; } },
    Input: { RegisterForControllerInputMessages(callback: typeof controllerListener) {
      controllerListener = callback;
      return { unregister() { controllerUnregistered += 1; } };
    } }
  };
  const apiInit = {
      connect(_version: number, name: string) {
        apiNames.push(name);
        return { _version: 2, toaster: { toast(notification: { title?: string; body?: string; playSound?: boolean }) { toastCalls.push(notification); } }, call(...args: unknown[]) { rpcCalls.push(args); } };
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
  const videoPlayback = {
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
    pause() { this.pauseCalls += 1; this.paused = true; }
  };
  const mountPanel = (content: React.ReactElement) => create(content, {
    createNodeMock(element) {
      if (element.type === "video") return videoPlayback;
      if (element.type !== "div") return null;
      const messageId = element.props["data-decky-message-id"];
      if (typeof messageId === "string") return messageDomElement(messageId);
      if (typeof element.props.onCancel === "function" && typeof element.props.onFocusCapture === "function") {
        return { ownerDocument: mockDocument, querySelectorAll() { conversationMessageQueries += 1; return [...messageDomElements.values()]; } };
      }
      return { ownerDocument: mockDocument, querySelectorAll() { return []; }, querySelector() { return null; } };
    }
  });

  let renderer: ReturnType<typeof create> | undefined;
  let descriptor: { name: string; content: React.ReactElement; onDismount?: () => void } | undefined;
  try {
    const { default: initialize } = await import("../../../artifacts/decky-whatsapp-mock/dist/index.js?active-react-mount");
    descriptor = initialize() as typeof descriptor;
    assert.equal(descriptor?.name, "Decky WhatsApp MOCK");
    assert.ok(resumeCallback, "the offline MOCK entrypoint should register its isolated Steam resume callback");
    await act(async () => { renderer = mountPanel(descriptor!.content); });
    await flush();
    const mockPanelScopes = renderer!.root.findAll((node) => node.props["data-decky-scope"] === "mock-panel");
    assert.equal(mockPanelScopes.length, 1, "the MOCK contacts controls should share one scoped CDP target");
    assert.equal(mockPanelScopes[0].props["data-decky-provider"], "mock");
    assert.equal(mockPanelScopes[0].props["data-decky-label"], "MOCK / OFFLINE");
    assert.equal(mockPanelScopes[0].props["aria-label"], "MOCK / OFFLINE");
    assert.ok(renderer!.root.findAllByType("input").some((input) => input.props["aria-label"] === "Search mock contacts"));
    assert.ok(findButton(renderer!, "Start"));
    await act(async () => { resumeCallback?.(); });
    assert.ok(findButton(renderer!, "Start"), "resume while disabled must not enable or reconnect the MOCK panel");

    await act(async () => { findButton(renderer!, "Settings")!.props.onClick(); });
    assert.equal(renderer!.root.findAll((node) => node.props["data-decky-scope"] === "mock-panel").length, 1,
      "the MOCK scope should persist while settings are visible");
    await act(async () => { findButton(renderer!, "Back to contacts")!.props.onClick(); });

    await act(async () => { findButton(renderer!, "Start")!.props.onClick(); });
    await flush();
    await act(async () => { resumeCallback?.(); resumeCallback?.(); });
    await flush();
    const ava = findButton(renderer!, "Ava Example");
    assert.ok(ava, "fixture contact should load after enabling the mock connection");
    await act(async () => { findButton(renderer!, "Simulate incoming message")!.props.onClick(); });
    assert.ok(findButton(renderer!, "Deterministic incoming mock"), "active provider subscription should render a fabricated incoming event");
    assert.equal(renderer!.root.findAllByType("button").filter((button) => textOf(button as unknown as { children: unknown[] }).includes("Deterministic incoming mock")).length, 1,
      "repeated resume callbacks must not leak MOCK subscriptions or duplicate events");
    await act(async () => { findButton(renderer!, "Simulate reaction to your message")!.props.onClick(); });
    await flush();
    assert.equal(toastCalls.filter((toast) => toast.title === "Reaction to your message" && toast.body === "🌱").length, 1,
      "a fabricated incoming reaction to the user's own message should reach the Decky toast API once");
    await act(async () => { ava!.props.onClick(); });
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 180)); });
    await flush();
    assert.ok(findButton(renderer!, "Did you see the mock album?"), "fixture history should render after opening a conversation");
    assert.equal(renderer!.root.findAll((node) => node.props["data-decky-scope"] === "mock-panel").length, 1,
      "the MOCK scope should persist while a conversation is visible");

    const video = renderer!.root.findByType("video");
    assert.equal(video.props["data-decky-message-id"], undefined);
    assert.equal(video.props.controls, true, "ordinary video exposes native controls");
    assert.notEqual(video.props.autoPlay, true, "ordinary video must not autoplay");
    assert.equal(video.props.preload, "metadata");
    assert.match(video.props.src, /^data:video\/webm;base64,GkXfo/);
    const encodedVideo = video.props.src.slice(video.props.src.indexOf(",") + 1);
    const videoBytes = Buffer.from(encodedVideo, "base64");
    assert.deepEqual([...videoBytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "fixture begins with the WebM EBML signature");
    assert.equal(videoBytes.length, 2366, "fixture retains the locally decoded fabricated clip bytes");
    assert.ok(renderer!.root.findAll((node) => node.type === "div" && textOf(node as unknown as { children: unknown[] }).includes("Video · select it and press Y")).length > 0,
      "ordinary video is labelled accurately");
    const videoRow = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === "mock-ava-video")
      .find((node) => typeof node.props.onFocusCapture === "function");
    assert.ok(videoRow, "ordinary video row should be focusable for controller playback");
    assert.match(textOf(videoRow as unknown as { children: unknown[] }), /select it and press Y/,
      "the player hint should mention controller playback");
    await act(async () => { videoRow.props.onFocusCapture(); });
    await act(async () => { controllerListener?.(0, 3, true); });
    assert.equal(videoPlayback.playCalls, 1, "controller Y starts ordinary video playback");
    assert.equal(videoPlayback.paused, false);
    await act(async () => { controllerListener?.(0, 3, true); });
    assert.equal(videoPlayback.pauseCalls, 1, "controller Y pauses an already-playing ordinary video");
    assert.equal(videoPlayback.paused, true);
    await act(async () => { video.props.onError(); });
    assert.ok(renderer!.root.findAll((node) => textOf(node as unknown as { children: unknown[] }).includes("Video unavailable")).length > 0,
      "video playback errors show an unavailable fallback");
    assert.ok(findButton(renderer!, "Retry media"), "the unavailable video can use the existing retry flow");

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
    await act(async () => { findButton(renderer!, "Reply to selected message")!.props.onClick(); });
    const viewerReplyDraft = renderer!.root.findAllByType("input").find((input) => input.props["aria-label"] === "Reply");
    assert.ok(viewerReplyDraft, "the selected fixture message should expose a reply draft before image Y");
    await act(async () => { viewerReplyDraft!.props.onChange({ target: { value: "Draft survives image viewer" } }); });

    const ordinaryMessageRow = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === "mock-ava-1")
      .find((node) => typeof node.props.onKeyDown === "function");
    assert.ok(ordinaryMessageRow, "ordinary messages should keep the prior div row wrapper");
    assert.equal(ordinaryMessageRow.props.onOptionsButton, undefined, "message rows must not bind image actions to the Decky options button");

    let imageRow = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === "mock-ava-2")
      .find((node) => typeof node.props.onOptionsButton === "function");
    assert.ok(imageRow, "the fabricated image row should expose its Decky gamepad action");
    assert.equal(typeof imageRow.props.onGamepadFocus, "function", "Decky gamepad focus should track the image row for controller Y");
    await act(async () => { imageRow!.props.onGamepadFocus(); });

    const focusedImageReactionText = () => {
      const row = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === "mock-ava-2")
        .find((node) => typeof node.props.onOptionsButton === "function");
      assert.ok(row, "the focused image row remains mounted");
      return textOf(row as unknown as { children: unknown[] });
    };
    const imageReactionBeforeX = focusedImageReactionText();
    await act(async () => { controllerListener?.(0, 2, true); });
    await flush();
    const imageReactionAfterX = focusedImageReactionText();
    assert.notEqual(imageReactionAfterX, imageReactionBeforeX, "controller X still mutates the focused MOCK conversation when the viewer is closed");
    assert.match(imageReactionAfterX, /❤️/, "normal controller X adds its configured reaction to the focused MOCK message");

    await act(async () => { controllerListener?.(0, 3, true); });
    assert.equal(modalCalls.length, 0, "the global controller listener must not open an image before Decky's cancellable row action");
    let optionsPrevented = false;
    let optionsStopped = false;
    await act(async () => { imageRow!.props.onOptionsButton({ preventDefault() { optionsPrevented = true; imageYOrder.push("prevent"); }, stopPropagation() { optionsStopped = true; imageYOrder.push("stop"); } }); });
    assert.equal(optionsPrevented, true, "the Decky image action should suppress default controller navigation");
    assert.equal(optionsStopped, true, "the Decky image action should not bubble into Quick Access navigation");
    assert.deepEqual(imageYOrder, ["prevent", "stop", "open"], "raw Y is ignored and Decky's cancellable action is contained before opening");
    assert.equal(modalCalls.length, 1, "the focused row's Decky action opens one SteamUI modal for the MOCK image");
    const reactionTextBeforeViewerX = focusedImageReactionText();
    await act(async () => { controllerListener?.(0, 2, true); });
    await flush();
    assert.equal(focusedImageReactionText(), reactionTextBeforeViewerX, "controller X is ignored while the image viewer is active and cannot mutate the underlying conversation");
    assert.equal(modalCalls[0].options?.strTitle, "Image viewer");
    const imageViewer = modalCalls[0].modal as React.ReactElement<{ imageDataUrl: string }>;
    assert.equal(imageViewer.props.imageDataUrl, "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#276b91"/><text x="12" y="55" fill="white" font-size="16">MOCK IMAGE</text></svg>'),
      "the modal should receive the locally fabricated image at its original data URL");
    assert.ok(findButton(renderer!, "Mounted-panel mock send"), "image Y should leave the conversation mounted until Steam closes Quick Access");
    assert.ok(findButton(renderer!, "Reply to selected message"), "image Y should preserve the selected message before the modal handoff");

    await act(async () => { controllerListener?.(0, 3, true); });
    assert.equal(modalCalls.length, 1, "controller Y while the viewer is open must not create another modal");

    await act(async () => { renderer!.unmount(); });
    renderer = undefined;
    assert.equal(modalCloseCalls, 0, "the Steam-triggered panel unmount must leave the independently owned image modal open");
    const closeFirstImageViewer = (imageViewer.props as { onCancel: () => void }).onCancel;
    await act(async () => { closeFirstImageViewer(); });
    assert.equal(modalCloseCalls, 1, "B closes the viewer without discarding its conversation handoff");

    activeMockElement = { matches: (selector) => selector === "input, textarea, select" };
    mockScrollViewport.scrollTop = 0;
    conversationMessageQueries = 0;
    imageBoundsCalls = 0;
    await act(async () => { renderer = mountPanel(descriptor!.content); });
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 220)); });
    await flush();
    await flush();
    assert.ok(messageDomElements.has("mock-ava-2"), "the returned image has a synthetic DOM target for focus/scroll restoration");
    assert.ok(conversationMessageQueries > 0 && imageBoundsCalls > 0, "the returned image row participates in DOM scroll restoration");
    assert.ok(findButton(renderer!, "Did you see the mock album?"), "closing the viewer and remounting the panel restores the same MOCK conversation");
    assert.ok(findButton(renderer!, "Reply to selected message"), "the selected message is restored after the modal handoff");
    assert.ok(renderer!.root.findAllByType("input").some((input) => input.props["aria-label"] === "Reply" && input.props.value === "Draft survives image viewer"),
      "the in-memory reply draft survives the modal-triggered panel unmount");
    imageRow = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === "mock-ava-2")
      .find((node) => typeof node.props.onOptionsButton === "function")!;
    assert.ok(imageRow, "the focused image selection is restored after the panel remount");
    assert.equal(imageRow.props.preferredFocus, true, "Steam navigation marks the restored image as its preferred child");
    const restoredConversationFocusable = renderer!.root.findAll((node) => typeof node.props.onCancel === "function" && typeof node.props.onFocusCapture === "function")[0];
    assert.equal(restoredConversationFocusable.props.navEntryPreferPosition, 4, "the remounted conversation enters on its preferred image row instead of Load more messages");
    assert.equal(mockScrollViewport.scrollTop, 650, "the image scroll anchor is reapplied after a session change clears the history expansion anchor");
    assert.equal(imageDomFocusCalls, 0, "restoring the image scroll does not steal DOM focus from the reply input");
    assert.ok(findButton(renderer!, "Back to contacts"), "restoration returns to the conversation rather than the contacts page");
    activeMockElement = null;
    await act(async () => { controllerListener?.(0, 2, true); });
    await flush();
    assert.notEqual(focusedImageReactionText(), reactionTextBeforeViewerX, "controller X works again after the image viewer closes");

    let keyboardYPrevented = false;
    const keyboardOrderStart = imageYOrder.length;
    await act(async () => { imageRow!.props.onKeyDown({ key: "y", preventDefault() { keyboardYPrevented = true; imageYOrder.push("prevent"); }, stopPropagation() { imageYOrder.push("stop"); } }); });
    assert.equal(keyboardYPrevented, true, "keyboard Y on an image should be consumed");
    assert.deepEqual(imageYOrder.slice(keyboardOrderStart), ["prevent", "stop"], "keyboard Y is consumed without bypassing Decky's cancellable image action");
    assert.equal(modalCalls.length, 1, "keyboard Y must not open an image viewer outside Decky's row action");

    let secondOptionsPrevented = false;
    let secondOptionsStopped = false;
    const secondOptionsOrderStart = imageYOrder.length;
    await act(async () => { imageRow!.props.onOptionsButton({ preventDefault() { secondOptionsPrevented = true; imageYOrder.push("prevent"); }, stopPropagation() { secondOptionsStopped = true; imageYOrder.push("stop"); } }); });
    assert.equal(secondOptionsPrevented, true);
    assert.equal(secondOptionsStopped, true);
    assert.deepEqual(imageYOrder.slice(secondOptionsOrderStart), ["prevent", "stop", "open"], "the Decky action cancels navigation before the next modal opens");
    assert.equal(modalCalls.length, 2, "the Decky row action reopens the viewer after explicit dismissal");
    await act(async () => { closeFirstImageViewer(); });
    assert.equal(modalCloseCalls, 1, "a stale close callback cannot close or release a newer viewer");
    await act(async () => { imageRow!.props.onOptionsButton({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(modalCalls.length, 2, "a stale close callback cannot clear the active viewer guard");

    await act(async () => { controllerListener?.(0, 3, true); });
    assert.equal(modalCalls.length, 2, "controller Y while the viewer is open must not create another image modal");
    assert.ok(findButton(renderer!, "Mounted-panel mock send"), "controller Y on an image should leave the conversation mounted");
    assert.ok(findButton(renderer!, "Reply to selected message"), "controller Y on an image should preserve reply selection");
    assert.ok(findButton(renderer!, "Back to contacts"), "controller Y on an image should not navigate back to contacts");

    const conversationFocusable = renderer!.root.findAll((node) => typeof node.props.onCancel === "function" && typeof node.props.onFocusCapture === "function")[0];
    assert.ok(conversationFocusable, "the active conversation should handle its own B/cancel navigation");
    const secondImageViewer = modalCalls[1].modal as React.ReactElement<{ onClose?: () => void; onCancel?: () => void }>;
    assert.equal(typeof secondImageViewer.props.onCancel, "function", "the mounted SteamUI modal provides its cancel callback to the viewer target");
    let viewerFocusRefCalls = 0;
    let viewerElementFocusCalls = 0;
    const viewerFocusRenderer = create(React.createElement(ImageViewerFocusTarget, {
      FocusableComponent: React.forwardRef<HTMLDivElement, { children?: React.ReactNode; [key: string]: unknown }>((props, ref) => React.createElement("div", { ...props, ref }, props.children)),
      navEntryPreferPosition: 0,
      onCancel: secondImageViewer.props.onCancel || (() => secondImageViewer.props.onClose?.()),
      focusTargetRef: (element) => {
        if (!element) return;
        viewerFocusRefCalls += 1;
        element.focus({ preventScroll: true });
      }
    }, React.createElement("img", { src: "data:image/png;base64,AA==" })), {
      createNodeMock(element) {
        if (element.type !== "div") return null;
        return { focus() { viewerElementFocusCalls += 1; } };
      }
    });
    const viewerFocusable = viewerFocusRenderer.root.findByType("div");
    assert.equal(viewerFocusable.props.tabIndex, 0, "the viewer's Decky Focusable target is explicitly programmatically focusable");
    assert.equal(viewerFocusRefCalls, 1, "the viewer target ref receives its mounted element");
    assert.equal(viewerElementFocusCalls, 1, "the viewer target's mounted element is programmatically focused through that ref");
    let cancelPrevented = false;
    let cancelStopped = false;
    const viewerCancelEvent = {
      preventDefault() { cancelPrevented = true; },
      stopPropagation() { cancelStopped = true; }
    };
    await act(async () => {
      viewerFocusable.props.onCancel(viewerCancelEvent);
      if (!cancelStopped) conversationFocusable!.props.onCancel(viewerCancelEvent);
    });
    assert.equal(cancelPrevented, true, "the viewer's own Focusable target prevents Decky navigation");
    assert.equal(cancelStopped, true, "the viewer's own Focusable target stops B from reaching conversation navigation");
    assert.equal(modalCloseCalls, 2, "the same B/cancel should close the active image viewer exactly once");
    assert.ok(findButton(renderer!, "Mounted-panel mock send"), "B/cancel closing the image viewer should preserve the conversation");
    assert.ok(findButton(renderer!, "Back to contacts"), "B/cancel on the image viewer must not navigate back to contacts");
    viewerFocusRenderer.unmount();

    await flush();
    let optionsPressPrevented = false;
    let optionsPressStopped = false;
    await act(async () => { imageRow!.props.onOptionsButton({ preventDefault() { optionsPressPrevented = true; }, stopPropagation() { optionsPressStopped = true; } }); });
    assert.equal(optionsPressPrevented, true, "Decky's focused Y action should suppress default navigation");
    assert.equal(optionsPressStopped, true, "Decky's focused Y action should stay inside the MOCK image row");
    assert.equal(modalCalls.length, 3, "the image viewer should reopen after B/cancel closes it");
    const thirdImageViewer = modalCalls[2].modal as React.ReactElement<{ onClose?: () => void; onCancel?: () => void }>;
    await act(async () => { controllerListener?.(0, 3, true); });
    assert.equal(modalCalls.length, 3, "the shared controller Y listener must not duplicate an active viewer");
    // B was released before this delayed ModalRoot callback. No raw B listener
    // or time-based latch is needed because the modal Focusable consumed B.
    await act(async () => { controllerListener?.(0, 1, false); });
    await act(async () => { thirdImageViewer.props.onCancel?.(); });
    assert.ok(findButton(renderer!, "Mounted-panel mock send"), "a delayed ModalRoot cancel after B release preserves the conversation");
    assert.ok(findButton(renderer!, "Back to contacts"), "the delayed modal callback does not navigate to contacts");
    cancelPrevented = false;
    cancelStopped = false;
    await act(async () => { conversationFocusable!.props.onCancel({ preventDefault() { cancelPrevented = true; }, stopPropagation() { cancelStopped = true; } }); });
    assert.equal(cancelPrevented, true, "a later B is handled by the conversation after modal dismissal");
    assert.equal(cancelStopped, true, "the later conversation B is contained within its Focusable");
    assert.ok(findButton(renderer!, "Second Session — Nia"), "the later B returns to contacts normally");

    await act(async () => { renderer!.unmount(); });
    renderer = undefined;
    await act(async () => { renderer = mountPanel(descriptor!.content); });
    await flush();
    assert.ok(findButton(renderer!, "Ava Example"), "an ordinary later panel reopen starts at contacts");
    assert.equal(findButton(renderer!, "Did you see the mock album?"), undefined, "a consumed viewer handoff cannot restore stale conversation navigation");

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
    assert.equal(renderer!.root.findAllByType("video").length, 0, "the view-once video placeholder must not expose a player");
    for (const messageId of viewOnceIds) {
      const row = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === messageId)
        .find((node) => typeof node.props.onKeyDown === "function")!;
      let yPreventedForMedia = false;
      await act(async () => { row.props.onKeyDown({ key: "y", preventDefault() { yPreventedForMedia = true; }, stopPropagation() {} }); });
      assert.equal(yPreventedForMedia, false, `${messageId} must not consume Y as a media action`);
    }
    assert.deepEqual(networkUrls, [], "view-once Y presses must not request media over fetch or WebSocket");

    await act(async () => { findButton(renderer!, "Back to contacts")!.props.onClick(); });
    await act(async () => { findButton(renderer!, "Ava Example")!.props.onClick(); });
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 180)); });
    await flush();
    const activeImageRow = renderer!.root.findAll((node) => node.props["data-decky-message-id"] === "mock-ava-2")
      .find((node) => typeof node.props.onOptionsButton === "function");
    assert.ok(activeImageRow, "Ava's fabricated image should be available to open before unmount");
    await act(async () => { activeImageRow!.props.onOptionsButton({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(modalCalls.length, 4, "the panel has an active image modal at unmount");

    await act(async () => { renderer!.unmount(); });
    assert.equal(modalCloseCalls, 3, "an ordinary panel unmount leaves the independently owned image modal open");
    descriptor.onDismount?.();
    assert.equal(modalCloseCalls, 4, "full plugin dismount closes the active image modal exactly once");
    renderer = undefined;
    assert.equal(intervals.size, 0, "unmount should clear the health polling interval");
    assert.ok(controllerUnregistered >= 1, "unmount should unregister controller handlers");
    assert.equal(resumeUnregistered, 1, "plugin dismount should unregister the Decky resume handler");
    await act(async () => { resumeCallback?.(); });
    assert.equal(intervals.size, 0, "a saved late resume callback after dismount must not restart panel work");

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
