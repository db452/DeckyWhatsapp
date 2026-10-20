// Format contact timestamps using the Deck's local date and time settings.
export function formatChatTimestamp(value: number | undefined, now = new Date()): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) return "Yesterday";
  return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
}
