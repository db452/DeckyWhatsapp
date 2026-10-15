// Browser helpers for reconnecting sockets, queued refreshes, and cancellable fetches.
type SocketOptions = {
  url: () => Promise<string>;
  onMessage: (data: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
  retryDelay?: number;
};

// Coalesce overlapping refresh triggers without dropping the one that arrives
// while the current request is still settling.
export function createQueuedRequest(request: () => Promise<void>): () => Promise<void> {
  let running = false;
  let queued = false;

  return async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    let lastError: { value: unknown } | undefined;
    try {
      do {
        queued = false;
        try {
          await request();
          lastError = undefined;
        } catch (error) {
          lastError = { value: error };
        }
      } while (queued);
    } finally {
      running = false;
    }
    if (lastError) throw lastError.value;
  };
}

// Both the panel and notifications must survive a bridge restart, and must
// not open a late socket after their owner has stopped/unmounted.
export function connectSocket(options: SocketOptions) {
  let stopped = false;
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;

  const retry = () => {
    if (stopped || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, options.retryDelay ?? 2000);
  };

  const connect = async () => {
    try {
      const url = await options.url();
      if (stopped) return;
      const current = new WebSocket(url);
      socket = current;
      const lost = () => {
        if (stopped || socket !== current) return;
        clearTimeout(openTimer);
        socket = undefined;
        current.close();
        options.onClose?.();
        retry();
      };
      openTimer = setTimeout(lost, 15_000);
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
        lost();
      };
      current.onclose = lost;
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
