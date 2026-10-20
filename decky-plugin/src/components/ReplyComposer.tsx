import { ButtonItem, PanelSectionRow, TextField } from "@decky/ui";
import { FaMicrophone, FaPaperPlane, FaReply, FaStop } from "react-icons/fa";
import type { Ref } from "react";
import type { ReplyTarget } from "../types/conversation";

type ReplyComposerProps = {
  containerRef: Ref<HTMLDivElement>;
  replyTarget?: ReplyTarget;
  reply: string;
  sending: boolean;
  voiceEnabled: boolean;
  voiceTypingAvailable: boolean | undefined;
  voiceState: "idle" | "recording" | "transcribing";
  onCancelReply: () => void;
  onReplyFocus: () => void;
  onReplyBlur: () => void;
  onReplyChange: (value: unknown) => void;
  onSend: () => void;
  onVoiceTyping: () => void;
};

export function ReplyComposer({ containerRef, replyTarget, reply, sending, voiceEnabled, voiceTypingAvailable, voiceState, onCancelReply, onReplyFocus, onReplyBlur, onReplyChange, onSend, onVoiceTyping }: ReplyComposerProps) {
  return <>
    <PanelSectionRow>
      <div ref={containerRef} data-testid="mock-reply-field" style={{ width: "100%" }}>
        {replyTarget && <div style={{ marginBottom: "8px", padding: "8px 10px", borderLeft: "3px solid #63d2ad", background: "rgba(255,255,255,0.08)", borderRadius: "4px" }}><div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", opacity: 0.8 }}><FaReply /> Replying to {replyTarget.sender}</div><div style={{ opacity: 0.65, fontSize: "12px", marginTop: "3px" }}>{replyTarget.body.slice(0, 120)}</div><ButtonItem layout="below" onClick={onCancelReply}>Cancel reply</ButtonItem></div>}
        <TextField key={replyTarget?.id || "new-reply"} label="Reply" value={reply} focusOnMount={Boolean(replyTarget)} onFocus={onReplyFocus} onBlur={onReplyBlur} onChange={onReplyChange} />
      </div>
    </PanelSectionRow>
    <PanelSectionRow><div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}><ButtonItem layout="below" disabled={sending || !reply.trim()} onClick={onSend}><span aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>{sending ? "Sending…" : <><FaPaperPlane /> Send reply</>}</span></ButtonItem>{voiceEnabled && <ButtonItem layout="below" disabled={voiceTypingAvailable === false} onClick={onVoiceTyping}><span style={{ display: "flex", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", fontSize: "24px", opacity: voiceTypingAvailable === false ? 0.5 : 1 }}>{voiceState === "recording" ? <FaStop aria-label="Stop recording" /> : <FaMicrophone aria-label="Voice typing" />}<span style={{ fontSize: "11px" }}>{voiceState === "recording" ? "Stop recording" : voiceTypingAvailable === false ? "Whisper not installed" : voiceState === "transcribing" ? "Transcribing…" : "Voice typing"}</span></span></ButtonItem>}</div></PanelSectionRow>
  </>;
}
