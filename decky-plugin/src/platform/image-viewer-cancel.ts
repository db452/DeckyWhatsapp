type FocusableCancelEvent = Pick<CustomEvent, "preventDefault" | "stopPropagation">;

/** The viewer's own focused Decky target consumes B before its dialog closes. */
export function handleImageViewerFocusableCancel(event: FocusableCancelEvent, closeImageViewer: () => void): void {
  event.preventDefault();
  event.stopPropagation();
  closeImageViewer();
}

/** Keep the conversation handler as a fallback if focus returns before the viewer handles B. */
export function handleConversationCancel(event: FocusableCancelEvent, imageViewerOpen: boolean, closeImageViewer: () => void, closeConversation: () => void): void {
  event.preventDefault();
  event.stopPropagation();

  if (imageViewerOpen) closeImageViewer();
  else closeConversation();
}
