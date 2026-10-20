import { ButtonItem, PanelSectionRow, TextField } from "@decky/ui";
import { FaReply } from "react-icons/fa";
import type { IncomingMessage } from "../types/message";
import type { DataProvider } from "../providers/provider";

type SelectedMessageActionsProps = {
  selectedMessage?: IncomingMessage;
  providerVariant: DataProvider["variant"];
  reactionEmoji: string;
  canRetry: boolean;
  canDelete: boolean;
  retryDisabled: boolean;
  deleteDisabled: boolean;
  editingMockMessage: boolean;
  editingMockMessageBody: string;
  onReply: () => void;
  onReact: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onBeginMockEdit: () => void;
  onMockMessageBodyChange: (value: unknown) => void;
  onSaveMockEdit: () => void;
  onCancelMockEdit: () => void;
};

export function SelectedMessageActions({ selectedMessage, providerVariant, reactionEmoji, canRetry, canDelete, retryDisabled, deleteDisabled, editingMockMessage, editingMockMessageBody, onReply, onReact, onRetry, onDelete, onBeginMockEdit, onMockMessageBodyChange, onSaveMockEdit, onCancelMockEdit }: SelectedMessageActionsProps) {
  return <>
    {selectedMessage && <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
      <div style={{ opacity: 0.65, fontSize: "12px" }}>Selected message actions</div>
      <ButtonItem layout="below" onClick={onReply}><span style={{ display: "flex", alignItems: "center", gap: "8px" }}><FaReply /> Reply to selected message</span></ButtonItem>
      <ButtonItem layout="below" onClick={onReact}><span>React {reactionEmoji} (X)</span></ButtonItem>
      {canRetry && <ButtonItem layout="below" disabled={retryDisabled} onClick={onRetry}>Retry message</ButtonItem>}
      {canDelete && <ButtonItem layout="below" disabled={deleteDisabled} onClick={onDelete}>Delete for everyone</ButtonItem>}
      {providerVariant === "mock" && selectedMessage.fromMe && <ButtonItem layout="below" onClick={onBeginMockEdit}>Edit mock message</ButtonItem>}
    </div></PanelSectionRow>}
    {editingMockMessage && providerVariant === "mock" && <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      <TextField label="Edit mock message" value={editingMockMessageBody} onChange={onMockMessageBodyChange} />
      <ButtonItem layout="below" onClick={onSaveMockEdit}>Save mock edit</ButtonItem>
      <ButtonItem layout="below" onClick={onCancelMockEdit}>Cancel mock edit</ButtonItem>
    </div></PanelSectionRow>}
  </>;
}
