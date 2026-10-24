import { Focusable, ModalRoot, NavEntryPositionPreferences } from "@decky/ui";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageViewerFocusTarget } from "./image-viewer-focus-target";

type ImageViewerModalProps = {
  imageDataUrl: string;
  imageLabel: string;
  onClose: () => void;
  onCancel?: () => void;
};

/** A full-size SteamUI modal keeps the image outside the plugin's Quick Access frame. */
export function ImageViewerModal({ imageDataUrl, imageLabel, onClose, onCancel }: ImageViewerModalProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const focusFrame = useRef<{ ownerWindow: Window; id: number } | undefined>(undefined);
  const captureOwnerDocument = useCallback((element: HTMLDivElement | null) => {
    if (element) setPortalTarget(element.ownerDocument.documentElement);
  }, []);
  const focusViewerTarget = useCallback((element: HTMLDivElement | null) => {
    const pending = focusFrame.current;
    if (pending) {
      pending.ownerWindow.cancelAnimationFrame(pending.id);
      focusFrame.current = undefined;
    }
    if (!element) return;
    const ownerWindow = element.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const id = ownerWindow.requestAnimationFrame(() => {
      focusFrame.current = undefined;
      if (element.isConnected) element.focus({ preventScroll: true });
    });
    focusFrame.current = { ownerWindow, id };
  }, []);

  return <ModalRoot bAllowFullSize bHideCloseIcon onCancel={onCancel || onClose} onEscKeypress={onClose} closeModal={onClose}>
    <div ref={captureOwnerDocument} style={{ display: "none" }} />
    {portalTarget && createPortal(
      <ImageViewerFocusTarget
        FocusableComponent={Focusable}
        navEntryPreferPosition={NavEntryPositionPreferences.FIRST}
        focusTargetRef={focusViewerTarget}
        onCancel={onCancel || onClose}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "80vw",
            height: "80vh",
            boxSizing: "border-box",
            padding: 20,
            overflow: "hidden",
            background: "#111418",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: 12,
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.55)",
          }}
        >
          <img
            src={imageDataUrl}
            alt={imageLabel}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
          />
        </div>
      </ImageViewerFocusTarget>,
      portalTarget,
    )}
  </ModalRoot>;
}
