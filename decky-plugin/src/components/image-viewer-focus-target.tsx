import React, { type ComponentType, type CSSProperties, type ReactNode, type RefAttributes } from "react";
import { handleImageViewerFocusableCancel } from "../platform/image-viewer-cancel";

type DeckyFocusableProps = {
  children: ReactNode;
  tabIndex: number;
  noFocusRing: boolean;
  navEntryPreferPosition: number;
  onCancel: (event: CustomEvent) => void;
  style: CSSProperties;
};

type ImageViewerFocusTargetProps = {
  children: ReactNode;
  FocusableComponent: ComponentType<DeckyFocusableProps & RefAttributes<HTMLDivElement>>;
  navEntryPreferPosition: number;
  onCancel: () => void;
  focusTargetRef?: (element: HTMLDivElement | null) => void;
};

/** Pass the dialog's B action through a dedicated Decky focus target. */
export function ImageViewerFocusTarget({
  children,
  FocusableComponent,
  navEntryPreferPosition,
  onCancel,
  focusTargetRef
}: ImageViewerFocusTargetProps) {
  return <FocusableComponent
    ref={focusTargetRef}
    tabIndex={0}
    noFocusRing
    navEntryPreferPosition={navEntryPreferPosition}
    onCancel={(event) => handleImageViewerFocusableCancel(event, onCancel)}
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 2147483647,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      padding: 24,
      background: "rgba(0, 0, 0, 0.78)",
    }}
  >
    {children}
  </FocusableComponent>;
}
