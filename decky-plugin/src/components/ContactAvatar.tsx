import { getAvatarStyle, getInitials } from "../utils/avatar";
import type { ChatSummary } from "../types/chat";

type ContactAvatarProps = {
  chat: ChatSummary;
  size?: number;
};

// Render a contact photo when available, otherwise use the established initials fallback.
export function ContactAvatar({ chat, size = 42 }: ContactAvatarProps) {
  if (chat.profilePicUrl) {
    return <img src={chat.profilePicUrl} alt="" style={{ width: `${size}px`, height: `${size}px`, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }

  return (
    <div aria-label="Generic profile picture" style={{ ...getAvatarStyle(chat.chatName), width: `${size}px`, height: `${size}px` }}>
      {getInitials(chat.chatName)}
    </div>
  );
}
