import type { CSSProperties } from "react";

// Keep initials and colors deterministic so the same contact has a stable fallback avatar.
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export function getAvatarStyle(name: string): CSSProperties {
  const colors = ["#2f6f67", "#76558f", "#8a5c38", "#35658a", "#806b32"];
  const index = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length;
  return {
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    background: colors[index],
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontWeight: 700,
    fontSize: "14px",
    letterSpacing: "0.5px"
  };
}
