export function uniqueReactions(reactions: string[] | undefined): string[] | undefined {
  const seen = new Set<string>();
  const unique = (reactions || []).filter((reaction) => {
    if (!reaction) return false;
    const key = reaction.normalize("NFC").replace(/\uFE0F/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length > 0 ? unique : undefined;
}
