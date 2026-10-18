// Describe the safe fallback without suggesting Decky opened or marked it viewed.
export function getViewOnceNotice(viewOnce?: boolean): string | undefined {
  return viewOnce
    ? "View-once media can't be opened in Decky WhatsApp. Check or open it in WhatsApp on your phone."
    : undefined;
}
