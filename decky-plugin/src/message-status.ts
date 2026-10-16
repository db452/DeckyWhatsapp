export type MessageStatus = { symbol: string; color: string; label: string };

// Translate WhatsApp acknowledgement state into the label shown beside sent messages.
export function getMessageStatus(ack?: number, deliveryUncertain = false): MessageStatus {
  if (deliveryUncertain) return { symbol: "?", color: "#ffbd75", label: "Delivery uncertain" };
  if (ack === -1) return { symbol: "!", color: "#ff8d8d", label: "Failed" };
  if (ack === 0) return { symbol: "…", color: "rgba(255,255,255,0.55)", label: "Sending" };
  if (ack !== undefined && ack >= 3) return { symbol: "✓✓", color: "#63b9ff", label: "Read" };
  if (ack !== undefined && ack >= 2) return { symbol: "✓✓", color: "rgba(255,255,255,0.65)", label: "Delivered" };
  return { symbol: "✓", color: "rgba(255,255,255,0.65)", label: "Sent" };
}
