import assert from "node:assert/strict";
import { test } from "node:test";
import { attachResumeRegistration } from "../plugin-lifecycle";
import { registerControllerInputMessages, registerOnResumeFromSuspend } from "./steam-compat";

type SteamGlobal = typeof globalThis & { SteamClient?: unknown };

function withSteamClient<T>(steamClient: unknown, run: () => T): T {
  const target = globalThis as SteamGlobal;
  const previous = Object.getOwnPropertyDescriptor(target, "SteamClient");
  Object.defineProperty(target, "SteamClient", { configurable: true, value: steamClient });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(target, "SteamClient", previous);
    else Reflect.deleteProperty(target, "SteamClient");
  }
}

async function withSteamClientAsync<T>(steamClient: unknown, run: () => Promise<T>): Promise<T> {
  const target = globalThis as SteamGlobal;
  const previous = Object.getOwnPropertyDescriptor(target, "SteamClient");
  Object.defineProperty(target, "SteamClient", { configurable: true, value: steamClient });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(target, "SteamClient", previous);
    else Reflect.deleteProperty(target, "SteamClient");
  }
}

function withEmptyProductionSteamRegistry<T>(run: () => T): T {
  const key = Symbol.for("decky-whatsapp.steam-listener-registry");
  const symbols = globalThis as unknown as { [key: symbol]: { listeners: Map<unknown, unknown> } | undefined };
  const registry = symbols[key] ?? { listeners: new Map<unknown, unknown>() };
  if (!(registry.listeners instanceof Map)) registry.listeners = new Map();
  symbols[key] = registry;
  const previousEntries = [...registry.listeners.entries()];
  registry.listeners.clear();
  try {
    return run();
  } finally {
    registry.listeners.clear();
    for (const [kind, entry] of previousEntries) registry.listeners.set(kind, entry);
  }
}

async function withEmptySteamRegistries<T>(run: () => Promise<T>): Promise<T> {
  const keys = [
    Symbol.for("decky-whatsapp.steam-listener-registry"),
    Symbol.for("decky-whatsapp-mock.steam-listener-registry")
  ];
  const previous = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const key of keys) Reflect.deleteProperty(globalThis, key);
  try {
    return await run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

let moduleInstance = 0;
async function loadFreshSteamCompat() {
  const moduleUrl = new URL("./steam-compat.ts", import.meta.url);
  moduleUrl.searchParams.set("instance", String(++moduleInstance));
  return import(moduleUrl.href);
}

test("available controller and resume APIs dispatch and unregister safely", () => {
  let controllerListener: ((index: number, button: number, pressed: boolean) => void) | undefined;
  let resumeListener: (() => void) | undefined;
  let controllerUnregistered = 0;
  let resumeUnregistered = 0;
  let controllerEvents = 0;
  let resumeEvents = 0;

  withSteamClient({
    Input: { RegisterForControllerInputMessages(callback: typeof controllerListener) {
      controllerListener = callback;
      return { unregister() { controllerUnregistered++; } };
    } },
    System: { RegisterForOnResumeFromSuspend(callback: typeof resumeListener) {
      resumeListener = callback;
      return { unregister() { resumeUnregistered++; } };
    } }
  }, () => {
    const stopController = registerControllerInputMessages(() => controllerEvents++);
    const stopResume = registerOnResumeFromSuspend(() => resumeEvents++);
    controllerListener?.(0, 2, true);
    resumeListener?.();
    stopController();
    stopResume();
  });

  assert.equal(controllerEvents, 1);
  assert.equal(resumeEvents, 1);
  assert.equal(controllerUnregistered, 1);
  assert.equal(resumeUnregistered, 1);
});

test("undefined SteamClient and missing optional namespaces do not throw", () => {
  assert.doesNotThrow(() => withSteamClient(undefined, () => {
    registerControllerInputMessages(() => undefined)();
    registerOnResumeFromSuspend(() => undefined)();
  }));
  assert.doesNotThrow(() => withSteamClient({}, () => {
    registerControllerInputMessages(() => undefined)();
    registerOnResumeFromSuspend(() => undefined)();
  }));
});

test("a missing registration method is tolerated and can become available later", () => {
  let calls = 0;
  withSteamClient({ System: {} }, () => registerOnResumeFromSuspend(() => calls++)());

  let listener: (() => void) | undefined;
  withSteamClient({ System: { RegisterForOnResumeFromSuspend(callback: () => void) {
    listener = callback;
    return { unregister() {} };
  } } }, () => {
    const stop = registerOnResumeFromSuspend(() => calls++);
    listener?.();
    stop();
  });
  assert.equal(calls, 1);
});

test("thrown registrations are contained so unrelated UI initialization can continue", () => {
  assert.doesNotThrow(() => withSteamClient({ System: { RegisterForOnResumeFromSuspend() { throw new Error("unsupported"); } } }, () => {
    registerOnResumeFromSuspend(() => undefined)();
  }));
});

test("controller subscribers coexist and repeated mounts unregister without duplicate delivery", () => {
  let listener: ((index: number, button: number, pressed: boolean) => void) | undefined;
  let subscriptions = 0;
  let callsA = 0;
  let callsB = 0;
  withSteamClient({ Input: { RegisterForControllerInputMessages(callback: typeof listener) {
    subscriptions++;
    listener = callback;
    return { unregister() {} };
  } } }, () => {
    const stopA = registerControllerInputMessages(() => callsA++);
    const stopB = registerControllerInputMessages(() => callsB++);
    listener?.(0, 3, true);
    stopA();
    listener?.(0, 3, true);
    stopB();
    const stopRemount = registerControllerInputMessages(() => callsA++);
    listener?.(0, 3, true);
    stopRemount();
  });
  assert.equal(subscriptions, 2);
  assert.equal(callsA, 2);
  assert.equal(callsB, 2);
});

test("missing handles do not cause repeat registration and stale callbacks are released", () => {
  let listener: (() => void) | undefined;
  let subscriptions = 0;
  let oldCalls = 0;
  let newCalls = 0;
  withSteamClient({ System: { RegisterForOnResumeFromSuspend(callback: () => void) {
    subscriptions++;
    listener = callback;
    return undefined;
  } } }, () => {
    const stopFirst = registerOnResumeFromSuspend(() => oldCalls++);
    listener?.();
    stopFirst();
    const stopRemount = registerOnResumeFromSuspend(() => newCalls++);
    listener?.();
    stopRemount();
  });
  assert.equal(subscriptions, 1);
  assert.equal(oldCalls, 1);
  assert.equal(newCalls, 1);
});

test("invalid unregister methods are ignored and cleanup does not throw", () => {
  let listener: ((index: number, button: number, pressed: boolean) => void) | undefined;
  let subscriptions = 0;
  let calls = 0;
  withSteamClient({ Input: { RegisterForControllerInputMessages(callback: typeof listener) {
    subscriptions++;
    listener = callback;
    return { unregister: "not-a-function" };
  } } }, () => {
    const stop = registerControllerInputMessages(() => calls++);
    listener?.(0, 2, true);
    assert.doesNotThrow(stop);
    const stopRemount = registerControllerInputMessages(() => calls++);
    listener?.(0, 2, true);
    stopRemount();
  });
  assert.equal(subscriptions, 1);
  assert.equal(calls, 2);
});

test("fresh module instances reuse registrations with missing or throwing unregister handles", async () => {
  let resumeListener: (() => void) | undefined;
  let resumeSubscriptions = 0;
  let controllerListener: ((index: number, button: number, pressed: boolean) => void) | undefined;
  let controllerSubscriptions = 0;
  const sharedRegistryKey = Symbol.for("decky-whatsapp.steam-listener-registry");
  const previousRegistry = Object.getOwnPropertyDescriptor(globalThis, sharedRegistryKey);
  Reflect.deleteProperty(globalThis, sharedRegistryKey);
  try {
    await withSteamClientAsync({
    System: { RegisterForOnResumeFromSuspend(callback: () => void) {
      resumeSubscriptions++;
      resumeListener = callback;
      return { unregister() { throw new Error("unregister unsupported"); } };
    } },
    Input: { RegisterForControllerInputMessages(callback: typeof controllerListener) {
      controllerSubscriptions++;
      controllerListener = callback;
      return {};
    } }
    }, async () => {
    let oldResumeCalls = 0;
    let newResumeCalls = 0;
    const firstModule = await loadFreshSteamCompat();
    firstModule.prepareSteamListenerNamespace("production");
    const stopOldResume = firstModule.registerOnResumeFromSuspend(() => oldResumeCalls++);

    const secondModule = await loadFreshSteamCompat();
    secondModule.prepareSteamListenerNamespace("production");
    const stopNewResume = secondModule.registerOnResumeFromSuspend(() => newResumeCalls++);
    resumeListener?.();
    assert.doesNotThrow(stopOldResume);
    stopNewResume();
    assert.equal(resumeSubscriptions, 1);
    assert.equal(oldResumeCalls, 0);
    assert.equal(newResumeCalls, 1);

    let oldControllerCalls = 0;
    let newControllerCalls = 0;
    const thirdModule = await loadFreshSteamCompat();
    thirdModule.prepareSteamListenerNamespace("production");
    const stopOldController = thirdModule.registerControllerInputMessages(() => oldControllerCalls++);

    const fourthModule = await loadFreshSteamCompat();
    fourthModule.prepareSteamListenerNamespace("production");
    const stopNewController = fourthModule.registerControllerInputMessages(() => newControllerCalls++);
    controllerListener?.(0, 2, true);
    stopOldController();
    stopNewController();
    assert.equal(controllerSubscriptions, 1);
    assert.equal(oldControllerCalls, 0);
    assert.equal(newControllerCalls, 1);
    });
  } finally {
    if (previousRegistry) Object.defineProperty(globalThis, sharedRegistryKey, previousRegistry);
    else Reflect.deleteProperty(globalThis, sharedRegistryKey);
  }
});

test("production and MOCK listener registries coexist in either load order and survive same-variant remount", async () => {
  async function verifyOrder(firstNamespace: "production" | "mock", secondNamespace: "production" | "mock") {
    await withEmptySteamRegistries(async () => {
      const controllerNative: Array<(index: number, button: number, pressed: boolean) => void> = [];
      const resumeNative: Array<() => void> = [];
      let controllerUnregistered = 0;
      let resumeUnregistered = 0;
      await withSteamClientAsync({
        Input: { RegisterForControllerInputMessages(callback: (index: number, button: number, pressed: boolean) => void) {
          controllerNative.push(callback);
          return { unregister() { controllerUnregistered++; } };
        } },
        System: { RegisterForOnResumeFromSuspend(callback: () => void) {
          resumeNative.push(callback);
          return { unregister() { resumeUnregistered++; } };
        } }
      }, async () => {
        const firstModule = await loadFreshSteamCompat();
        firstModule.prepareSteamListenerNamespace(firstNamespace);
        let firstControllerCalls = 0;
        let firstResumeCalls = 0;
        const stopFirstController = firstModule.registerControllerInputMessages(() => firstControllerCalls++, firstNamespace);
        const stopFirstResume = firstModule.registerOnResumeFromSuspend(() => firstResumeCalls++, firstNamespace);

        const secondModule = await loadFreshSteamCompat();
        secondModule.prepareSteamListenerNamespace(secondNamespace);
        let secondControllerCalls = 0;
        let secondResumeCalls = 0;
        const stopSecondController = secondModule.registerControllerInputMessages(() => secondControllerCalls++, secondNamespace);
        const stopSecondResume = secondModule.registerOnResumeFromSuspend(() => secondResumeCalls++, secondNamespace);

        assert.equal(controllerNative.length, 2, "each bundle variant should own a controller subscription");
        assert.equal(resumeNative.length, 2, "each bundle variant should own a resume subscription");
        controllerNative.forEach((listener) => listener(0, 3, true));
        resumeNative.forEach((listener) => listener());
        assert.deepEqual([firstControllerCalls, secondControllerCalls, firstResumeCalls, secondResumeCalls], [1, 1, 1, 1]);

        const remountModule = await loadFreshSteamCompat();
        remountModule.prepareSteamListenerNamespace(firstNamespace);
        let remountedControllerCalls = 0;
        let remountedResumeCalls = 0;
        const stopRemountedController = remountModule.registerControllerInputMessages(() => remountedControllerCalls++, firstNamespace);
        const stopRemountedResume = remountModule.registerOnResumeFromSuspend(() => remountedResumeCalls++, firstNamespace);
        // Cleanup from the old mount must not unregister or remove the new callbacks.
        stopFirstController();
        stopFirstResume();
        controllerNative.forEach((listener) => listener(0, 3, true));
        resumeNative.forEach((listener) => listener());
        assert.deepEqual([firstControllerCalls, secondControllerCalls, remountedControllerCalls, firstResumeCalls, secondResumeCalls, remountedResumeCalls], [1, 2, 1, 1, 2, 1]);

        stopRemountedController();
        stopRemountedResume();
        assert.equal(controllerUnregistered, 1, "unregistering one variant must leave the other native listener active");
        assert.equal(resumeUnregistered, 1, "unregistering one variant must leave the other resume listener active");
        controllerNative.forEach((listener) => listener(0, 3, true));
        resumeNative.forEach((listener) => listener());
        assert.deepEqual([secondControllerCalls, secondResumeCalls], [3, 3]);

        stopSecondController();
        stopSecondResume();
        assert.equal(controllerUnregistered, 2);
        assert.equal(resumeUnregistered, 2);
      });
    });
  }

  await verifyOrder("production", "mock");
  await verifyOrder("mock", "production");
});

test("production plugin descriptor lifecycle tolerates unavailable and throwing resume APIs", () => {
  const content = { panel: "WhatsApp" };
  const descriptor = { name: "Decky WhatsApp", content };

  withEmptyProductionSteamRegistry(() => {
    withSteamClient(undefined, () => {
      const plugin = attachResumeRegistration(descriptor, () => undefined);
      assert.equal(plugin.content, content);
      assert.doesNotThrow(() => plugin.onDismount?.());
    });
  });

  let registerCalls = 0;
  withEmptyProductionSteamRegistry(() => {
    withSteamClient({ System: { RegisterForOnResumeFromSuspend() {
      registerCalls++;
      throw new Error("unsupported");
    } } }, () => {
      const plugin = attachResumeRegistration(descriptor, () => undefined);
      assert.equal(plugin.content, content);
      assert.doesNotThrow(() => plugin.onDismount?.());
    });
  });
  assert.equal(registerCalls, 1);
});

test("production descriptor dismount contains throwing unregister and releases resume callback", () => {
  const content = { panel: "WhatsApp" };
  let nativeResumeCallback: (() => void) | undefined;
  let unregisterCalls = 0;
  let cleanupCalls = 0;
  let resumeCalls = 0;
  const descriptor = {
    name: "Decky WhatsApp",
    content,
    onDismount: () => cleanupCalls++
  };

  withEmptyProductionSteamRegistry(() => withSteamClient({ System: { RegisterForOnResumeFromSuspend(callback: () => void) {
    nativeResumeCallback = callback;
    return { unregister() {
      unregisterCalls++;
      throw new Error("unregister unsupported");
    } };
  } } }, () => {
    const plugin = attachResumeRegistration(descriptor, () => resumeCalls++);
    assert.equal(plugin.content, content);
    assert.doesNotThrow(() => plugin.onDismount?.());
    assert.equal(unregisterCalls, 1);
    assert.equal(cleanupCalls, 1);
    nativeResumeCallback?.();
    assert.equal(resumeCalls, 0);
  }));
});
