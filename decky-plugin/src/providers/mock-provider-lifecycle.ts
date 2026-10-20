import type { BridgeEvent, DataProvider, ProviderConnection } from "./provider";

/** Own mock subscriptions so reset and remount never leave duplicate listeners. */
export function createMockProviderLifecycle(provider: DataProvider) {
  const connections = new Set<ProviderConnection>();

  return {
    subscribe(
      onEvent: (event: BridgeEvent) => void,
      onOpen: () => void,
      onError: () => void,
      onClose: () => void
    ): ProviderConnection {
      const connection = provider.subscribe(onEvent, onOpen, onError, onClose);
      connections.add(connection);
      return {
        get connected() { return connection.connected; },
        close() {
          if (!connections.delete(connection)) return;
          connection.close();
        }
      };
    },
    reset(): void {
      for (const connection of [...connections]) connection.close();
      connections.clear();
      provider.reset();
    },
    get activeSubscriptions(): number { return connections.size; }
  };
}
