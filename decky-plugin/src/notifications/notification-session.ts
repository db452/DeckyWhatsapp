// WhatsApp timestamps are Unix seconds; only accept events that cannot predate
// the current open notification socket session.
export function createNotificationSession() {
  let watermarkSeconds: number | undefined;

  return {
    open(nowMilliseconds = Date.now()): void {
      // Round upward because an event timestamp has only second precision. A
      // lower bound in the current partial second could admit older backlog.
      watermarkSeconds = Math.ceil(nowMilliseconds / 1000);
    },
    close(): void {
      watermarkSeconds = undefined;
    },
    accepts(timestamp: unknown, active: boolean): boolean {
      return active && watermarkSeconds !== undefined &&
        typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp > 0 &&
        timestamp >= watermarkSeconds;
    }
  };
}
