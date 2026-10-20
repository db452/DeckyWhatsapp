import type { IncomingMessage } from "../types.js";

const MAX_MEDIA_BASE64_LENGTH = 12_000_000;

/** Normalize an already-downloaded whatsapp-web.js payload without changing its media classification rules. */
export function normalizeDownloadedMedia(
  media: { mimetype: string; data: string; filename?: string | null },
  kind: NonNullable<IncomingMessage["media"]>["kind"]
): IncomingMessage["media"] | undefined {
  const normalizedMimeType = media.mimetype.split(";", 1)[0].trim().toLowerCase();
  const supportedVideo = kind === "video" && ["video/mp4", "video/webm"].includes(normalizedMimeType);
  const supported = kind === "video" ? supportedVideo
    : kind === "gif" ? normalizedMimeType.startsWith("video/")
      : kind === "audio" ? normalizedMimeType.startsWith("audio/")
        : normalizedMimeType.startsWith("image/");
  if (!supported || media.data.length > MAX_MEDIA_BASE64_LENGTH) return undefined;
  return {
    dataUrl: `data:${normalizedMimeType};base64,${media.data}`,
    filename: media.filename || undefined,
    kind,
    mimetype: normalizedMimeType
  };
}
