// Keep the most recently seen IDs so reconnects cannot repeat recent notifications.
export function createNotificationIdCache(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Notification ID cache limit must be a positive integer");

  const ids = new Set<string>();
  return {
    has(id: string): boolean {
      return ids.has(id);
    },
    remember(id: string): void {
      ids.add(id);
      while (ids.size > limit) {
        const oldest = ids.values().next().value;
        if (oldest === undefined) break;
        ids.delete(oldest);
      }
    }
  };
}
