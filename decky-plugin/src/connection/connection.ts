// Browser helpers for reconnecting sockets, queued refreshes, and cancellable fetches.
type SocketOptions = {
  url: () => Promise<string>;
  onMessage: (data: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
  retryDelay?: number;
};

// Keep the historical helper import path for existing tests and callers.
export { createQueuedRequest, createRevisionGuard } from "../messages/sync-helpers";

// Both the panel and notifications must survive a bridge restart, and must
// not open a late socket after their owner has stopped/unmounted.
export function connectSocket(options: SocketOptions) {
  let stopped = false;
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  const suspendGapThresholdMs = 60_000;
  const suspendCheckIntervalMs = 30_000;
  let lastSuspendCheck = Date.now();

  const retry = () => {
    if (stopped || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, options.retryDelay ?? 2000);
  };

  const lost = (current: WebSocket) => {
    if (stopped || socket !== current) return;
    clearTimeout(openTimer);
    socket = undefined;
    current.close();
    options.onClose?.();
    retry();
  };

  const suspendCheckTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = now - lastSuspendCheck;
    lastSuspendCheck = now;
    const current = socket;
    if (elapsed >= suspendGapThresholdMs && current) {
      // Steam's resume callback is primary, but a long browser timer gap also
      // detects suspend when Decky misses that callback. Run the guarded loss
      // path directly because close events can be delayed or suppressed.
      lost(current);
    }
  }, suspendCheckIntervalMs);

  const connect = async () => {
    try {
      const url = await options.url();
      if (stopped) return;
      const current = new WebSocket(url);
      socket = current;
      openTimer = setTimeout(() => lost(current), 15_000);
      current.onopen = () => {
        if (stopped || socket !== current) return;
        clearTimeout(openTimer);
        options.onOpen?.();
      };
      current.onmessage = (event) => {
        if (stopped || socket !== current) return;
        try { options.onMessage(String(event.data)); }
        catch (error) { options.onError?.(error); }
      };
      current.onerror = (error) => {
        if (stopped || socket !== current) return;
        options.onError?.(error);
        lost(current);
      };
      current.onclose = () => lost(current);
    } catch (error) {
      if (stopped) return;
      options.onError?.(error);
      retry();
    }
  };

  void connect();
  return {
    get connected() { return socket?.readyState === WebSocket.OPEN; },
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(openTimer);
      clearInterval(suspendCheckTimer);
      socket?.close();
      socket = undefined;
    }
  };
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
