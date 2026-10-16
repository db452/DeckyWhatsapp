// Shared summary data used by the contacts list and conversation header.
export type ChatSummary = {
  chatId: string;
  chatName: string;
  profilePicUrl?: string;
  receivedSinceSession?: boolean;
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
};
