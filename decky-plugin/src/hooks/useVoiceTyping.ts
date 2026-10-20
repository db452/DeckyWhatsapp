import { toaster } from "@decky/api";
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "recording" | "transcribing";

type VoiceSession = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  sampleRate: number;
};

type UseVoiceTypingOptions = {
  getVoiceStatus: () => Promise<{ available: boolean; reason?: string }>;
  transcribeAudio: (audioBase64: string) => Promise<string>;
  panelMounted: { current: boolean };
  conversationRun: { current: number };
  onInsertReply: (text: string) => void;
  onError: (message: string) => void;
  onTransientStatus: (message: string) => void;
};

function encodeWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function useVoiceTyping({
  getVoiceStatus,
  transcribeAudio,
  panelMounted,
  conversationRun,
  onInsertReply,
  onError,
  onTransientStatus
}: UseVoiceTypingOptions) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceTypingAvailable, setVoiceTypingAvailable] = useState<boolean | undefined>(undefined);
  const [voiceTypingReason, setVoiceTypingReason] = useState("");
  const voiceSession = useRef<VoiceSession | undefined>(undefined);
  const voiceStarting = useRef(false);

  const stopRecording = useCallback(() => {
    const session = voiceSession.current;
    voiceSession.current = undefined;
    if (session) {
      session.processor.disconnect();
      session.source.disconnect();
      session.stream.getTracks().forEach((track) => track.stop());
      void session.context.close().catch(() => undefined);
    }
    return session;
  }, []);

  const resetVoice = useCallback(() => {
    stopRecording();
    setVoiceState("idle");
  }, [stopRecording]);

  useEffect(() => {
    let cancelled = false;
    void getVoiceStatus()
      .then((result) => {
        if (cancelled) return;
        setVoiceTypingAvailable(result.available);
        setVoiceTypingReason(result.reason === "not_configured"
          ? "Install the optional Deck-local Whisper engine first"
          : result.reason ? "Voice typing is unavailable" : "");
      })
      .catch(() => {
        // Older installations may not have the optional status method yet.
        // Keep the control usable and let transcription report its result.
        if (!cancelled) setVoiceTypingAvailable(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [getVoiceStatus]);

  useEffect(() => () => {
    stopRecording();
  }, [stopRecording]);

  const startVoiceTyping = async () => {
    if (voiceState === "transcribing" || voiceStarting.current) return;
    const run = conversationRun.current;
    const stillActive = () => panelMounted.current && conversationRun.current === run;
    if (voiceTypingAvailable === false) {
      toaster.toast({ title: "Voice typing unavailable", body: voiceTypingReason || "Install the optional Deck-local Whisper engine first", duration: 6000 });
      return;
    }
    if (voiceState === "recording") {
      const session = stopRecording();
      if (!session) return;
      setVoiceState("transcribing");
      onTransientStatus("Transcribing…");
      try {
        const wav = encodeWav(session.chunks, session.sampleRate);
        if (session.chunks.length === 0) throw new Error("No audio was captured from the microphone");
        const transcript = await transcribeAudio(arrayBufferToBase64(wav));
        if (!stillActive()) return;
        if (transcript.startsWith("__VOICE_ERROR__")) {
          const category = transcript.slice("__VOICE_ERROR__".length);
          if (category === "not_configured") {
            setVoiceTypingAvailable(false);
            setVoiceTypingReason("Install the optional Deck-local Whisper engine first");
          }
          const messages: Record<string, string> = {
            invalid_recording: "The recording could not be processed",
            not_configured: "Voice typing is not configured",
            no_speech: "No speech was detected. Try speaking closer to the microphone",
            transcription_failed: "Transcription failed. Check the Whisper installation and try again"
          };
          throw new Error(messages[category] || "Transcription failed");
        }
        if (!transcript?.trim()) throw new Error("Whisper returned no text");
        onInsertReply(transcript.trim());
        onTransientStatus("");
        toaster.toast({ title: "Voice typing", body: "Text added to your reply", duration: 3000 });
      } catch (voiceError) {
        if (!stillActive()) return;
        const message = voiceError instanceof Error && voiceError.message === "No audio was captured from the microphone"
          ? voiceError.message
          : "Transcription failed. Please try again";
        onError(message);
        toaster.toast({ title: "Voice typing failed", body: message, duration: 6000 });
      } finally {
        if (stillActive()) setVoiceState("idle");
      }
      return;
    }

    voiceStarting.current = true;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!stillActive()) { stream.getTracks().forEach((track) => track.stop()); return; }
      context = new AudioContext();
      await context.resume();
      if (!stillActive()) { stream.getTracks().forEach((track) => track.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentOutput = context.createGain();
      const chunks: Float32Array[] = [];
      silentOutput.gain.value = 0;
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(context.destination);
      voiceSession.current = { context, stream, source, processor, chunks, sampleRate: context.sampleRate };
      setVoiceState("recording");
      toaster.toast({ title: "Voice typing", body: "Recording… press the microphone again to stop", duration: 3000 });
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      if (stillActive()) onError("Microphone access failed");
    } finally {
      voiceStarting.current = false;
    }
  };

  return {
    voiceState,
    voiceTypingAvailable,
    startVoiceTyping,
    stopRecording,
    resetVoice
  };
}
