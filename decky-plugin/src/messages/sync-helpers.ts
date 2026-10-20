// Pure synchronization helpers shared by the panel without a transport dependency.
export function createQueuedRequest(request: () => Promise<void>): () => Promise<void> {
  let running = false;
  let queued = false;
  return async () => {
    if (running) { queued = true; return; }
    running = true;
    let lastError: { value: unknown } | undefined;
    try {
      do {
        queued = false;
        try { await request(); lastError = undefined; }
        catch (error) { lastError = { value: error }; }
      } while (queued);
    } finally { running = false; }
    if (lastError) throw lastError.value;
  };
}

export function createRevisionGuard() {
  let revision = 0;
  return {
    capture: () => revision,
    invalidate: () => { revision += 1; },
    isCurrent: (snapshot: number) => revision === snapshot
  };
}
