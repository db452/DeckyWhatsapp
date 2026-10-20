import { getViewOnceNotice } from "../messages/view-once";
import type { IncomingMessage } from "../types/message";

type MessageMediaProps = {
  message: IncomingMessage;
  onRetryMediaLoad: (messageId: string) => void;
  onMarkMediaUnavailable: (messageId: string) => void;
  registerAudioRef: (messageId: string, element: HTMLAudioElement | null) => void;
  registerVideoRef: (messageId: string, element: HTMLVideoElement | null) => void;
  onPlayAudio: (messageId: string) => void;
};

function mediaFallbackLabel(body: string): string | undefined {
  const labels: Record<string, string> = {
    "[Image]": "Image",
    "[Sticker]": "Sticker",
    "[GIF]": "GIF",
    "[Voice message]": "Voice message",
    "[Video]": "Video"
  };
  return labels[body.trim()];
}

export function MessageMedia({
  message,
  onRetryMediaLoad,
  onMarkMediaUnavailable,
  registerAudioRef,
  registerVideoRef,
  onPlayAudio
}: MessageMediaProps) {
  const viewOnceNotice = getViewOnceNotice(message.viewOnce);
  if (viewOnceNotice) {
    return <div role="status" style={{ marginTop: "8px", padding: "8px 10px", borderRadius: "8px", background: "rgba(255,255,255,0.08)", fontSize: "12px", lineHeight: 1.35 }}>{viewOnceNotice}</div>;
  }
  const knownMediaLabel = message.mediaKind === "audio" ? "Voice message"
    : message.mediaKind === "gif" ? "GIF"
      : message.mediaKind === "video" ? "Video"
      : message.mediaKind === "sticker" ? "Sticker"
        : message.mediaKind === "image" ? "Image"
          : mediaFallbackLabel(message.body);
  if (message.mediaLoadState === "unavailable") {
    const label = knownMediaLabel || "Media";
    const audioLayout = message.mediaKind === "audio" || label === "Voice message";
    return <div role="status" style={{ marginTop: "8px", minHeight: audioLayout ? "112px" : "180px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "6px", opacity: 0.7, fontSize: "12px" }}>
      <span>{label} unavailable</span>
      <button type="button" onClick={(event) => { event.stopPropagation(); onRetryMediaLoad(message.id); }} style={{ padding: "4px 8px", borderRadius: "6px", border: "0", color: "white", background: "rgba(255,255,255,0.12)" }}>Retry media</button>
    </div>;
  }
  if (!message.media && !message.image) {
    if (message.mediaLoadState === "loading" || message.mediaKind) {
      const mediaLabel = knownMediaLabel || "Media";
      const audioLayout = mediaLabel === "Voice message";
      return <div role="status" style={{ marginTop: "8px", minHeight: audioLayout ? "112px" : "180px", display: "flex", justifyContent: "center", alignItems: "center", opacity: 0.65, fontSize: "12px" }}>Loading {mediaLabel.toLowerCase()}…</div>;
    }
    if (knownMediaLabel) return <div role="status" style={{ marginTop: "8px", minHeight: knownMediaLabel === "Voice message" ? "112px" : "180px", display: "flex", justifyContent: "center", alignItems: "center", opacity: 0.65, fontSize: "12px" }}>{knownMediaLabel} unavailable</div>;
    return null;
  }
  const media = message.media || { ...message.image!, kind: "image" as const, mimetype: "image/jpeg" };
  // Reserved media slots keep later image/GIF decoding from shifting the reading position.
  if (media.kind === "audio" || media.mimetype.startsWith("audio/")) {
    return <div style={{ marginTop: "8px", minHeight: "112px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>Voice message · select it and press Y</div><audio ref={(element) => { registerAudioRef(message.id, element); }} src={media.dataUrl} aria-label="WhatsApp voice message" preload="auto" controls onError={() => { onMarkMediaUnavailable(message.id); console.error("[decky-whatsapp] voice media element error"); }} style={{ width: "100%" }} /><button type="button" onClick={(event) => { event.stopPropagation(); onPlayAudio(message.id); }} style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", border: "0", color: "white", background: "rgba(99, 210, 173, 0.35)" }}>▶ Play voice message</button></div>;
  }
  if (media.kind === "gif" || (media.kind !== "video" && media.mimetype.startsWith("video/"))) {
    return <div style={{ marginTop: "8px", height: "180px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>GIF</div><video src={media.dataUrl} aria-label={media.filename || "WhatsApp GIF"} autoPlay loop muted playsInline controls onError={() => onMarkMediaUnavailable(message.id)} style={{ display: "block", width: "100%", height: "156px", objectFit: "contain", borderRadius: "10px" }} /></div>;
  }
  if (media.kind === "video") {
    return <div style={{ marginTop: "8px", height: "180px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>Video · select it and press Y</div><video ref={(element) => { registerVideoRef(message.id, element); }} src={media.dataUrl} aria-label={media.filename || "WhatsApp video"} preload="metadata" playsInline controls onError={() => onMarkMediaUnavailable(message.id)} style={{ display: "block", width: "100%", height: "156px", objectFit: "contain", borderRadius: "10px" }} /></div>;
  }
  return <div style={{ marginTop: "8px", height: "180px" }}><div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "4px" }}>{media.kind === "sticker" ? "Sticker" : "Image"}</div><img src={media.dataUrl} alt={media.filename || (media.kind === "sticker" ? "WhatsApp sticker" : "WhatsApp image")} onError={() => onMarkMediaUnavailable(message.id)} style={{ display: "block", width: "100%", height: "156px", objectFit: "contain", borderRadius: "10px" }} /></div>;
}
