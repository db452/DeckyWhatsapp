type Unregisterable = { unregister?: unknown };

type ControllerCallback = (controllerIndex: number, gamepadButton: number, isButtonPressed: boolean) => void;

type SteamClientShape = {
  Input?: { RegisterForControllerInputMessages?: unknown };
  System?: { RegisterForOnResumeFromSuspend?: unknown };
};

type ListenerKind = "controller" | "resume";
export type SteamListenerNamespace = "production" | "mock";
const unavailable = Symbol("steam-api-unavailable");
type ListenerEntry = {
  callbacks: Set<(...args: never[]) => void>;
  unregister?: () => void;
};
type ListenerRegistry = { listeners: Map<ListenerKind, ListenerEntry> };

const globalSymbols = globalThis as unknown as { [key: symbol]: unknown };
const registryKeys: Record<SteamListenerNamespace, symbol> = {
  // Keep production on its historical key so an updated production bundle can
  // clean up callbacks from the already installed production bundle.
  production: Symbol.for("decky-whatsapp.steam-listener-registry"),
  mock: Symbol.for("decky-whatsapp-mock.steam-listener-registry")
};

function getRegistry(namespace: SteamListenerNamespace): ListenerRegistry {
  const key = registryKeys[namespace];
  let registry = globalSymbols[key] as ListenerRegistry | undefined;
  if (!registry || !(registry.listeners instanceof Map)) {
    registry = { listeners: new Map() };
    globalSymbols[key] = registry;
  }
  return registry;
}

/** Drop callbacks left by an earlier load of the same plugin variant only. */
export function prepareSteamListenerNamespace(namespace: SteamListenerNamespace): void {
  for (const entry of getRegistry(namespace).listeners.values()) entry.callbacks.clear();
}

function steamClientFromGlobal(): SteamClientShape | undefined {
  try {
    const value = (globalThis as typeof globalThis & { SteamClient?: unknown }).SteamClient;
    return value && typeof value === "object" ? value as SteamClientShape : undefined;
  } catch {
    return undefined;
  }
}

function reportRegistrationFailure(kind: ListenerKind): void {
  console.warn(`[Decky WhatsApp] Optional Steam ${kind} listener unavailable.`);
}

function isUnregisterable(value: unknown): value is Unregisterable {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function registerListener(namespace: SteamListenerNamespace, kind: ListenerKind, subscribe: (client: SteamClientShape, callback: (...args: never[]) => void) => unknown, callback: (...args: never[]) => void): () => void {
  const listeners = getRegistry(namespace).listeners;
  const existing = listeners.get(kind);
  if (existing) {
    existing.callbacks.add(callback);
    return () => {
      existing.callbacks.delete(callback);
      if (existing.callbacks.size > 0) return;
      if (!existing.unregister) return;
      try {
        existing.unregister();
        listeners.delete(kind);
      } catch {
        reportRegistrationFailure(kind);
        existing.unregister = undefined;
      }
    };
  }

  const client = steamClientFromGlobal();
  if (!client) {
    reportRegistrationFailure(kind);
    return () => undefined;
  }

  const entry: ListenerEntry = { callbacks: new Set([callback]) };
  const dispatch = (...args: never[]) => {
    for (const listener of [...entry.callbacks]) listener(...args);
  };
  try {
    const subscription = subscribe(client, dispatch);
    if (subscription === unavailable) {
      reportRegistrationFailure(kind);
      return () => undefined;
    }
    if (!isUnregisterable(subscription) || typeof subscription.unregister !== "function") {
      reportRegistrationFailure(kind);
    } else {
      entry.unregister = () => (subscription.unregister as () => void).call(subscription);
    }
    listeners.set(kind, entry);
  } catch {
    reportRegistrationFailure(kind);
    return () => undefined;
  }

  return () => {
    entry.callbacks.delete(callback);
    if (entry.callbacks.size > 0) return;
    if (!entry.unregister) return;
    try {
      entry.unregister();
      listeners.delete(kind);
    } catch {
      reportRegistrationFailure(kind);
      entry.unregister = undefined;
    }
  };
}

export function registerControllerInputMessages(callback: ControllerCallback, namespace: SteamListenerNamespace = "production"): () => void {
  return registerListener(namespace, "controller", (client, dispatch) => {
    const register = client.Input?.RegisterForControllerInputMessages;
    if (typeof register !== "function") return unavailable;
    return register.call(client.Input, dispatch as ControllerCallback);
  }, callback as (...args: never[]) => void);
}

export function registerOnResumeFromSuspend(callback: () => void, namespace: SteamListenerNamespace = "production"): () => void {
  return registerListener(namespace, "resume", (client, dispatch) => {
    const register = client.System?.RegisterForOnResumeFromSuspend;
    if (typeof register !== "function") return unavailable;
    return register.call(client.System, dispatch);
  }, callback as (...args: never[]) => void);
}
