# Decky backend for optional local Whisper voice transcription.
import asyncio
import base64
import binascii
import subprocess
import tempfile
import os
from pathlib import Path


DEFAULT_VOICE_ROOT = Path.home() / ".local" / "share" / "decky-whatsapp" / "voice"
DECK_VOICE_ROOT = Path("/home/deck/.local/share/decky-whatsapp/voice")
VOICE_ROOT = DECK_VOICE_ROOT if DECK_VOICE_ROOT.exists() else DEFAULT_VOICE_ROOT
WHISPER_PATH_FILE = VOICE_ROOT / "whisper-cli.path"
MODEL_PATH_FILE = VOICE_ROOT / "model.path"


class VoiceTypingFailure(RuntimeError):
    """A failure with a fixed, non-sensitive UI/log category."""

    def __init__(self, category: str):
        self.category = category
        super().__init__(category)


def _read_marker(path_file: Path) -> Path:
    if not path_file.is_file():
        raise VoiceTypingFailure("not_configured")
    value = path_file.read_text(encoding="utf-8").strip()
    if not value:
        raise VoiceTypingFailure("not_configured")
    return Path(value)


def _read_executable(path_file: Path) -> Path:
    executable = _read_marker(path_file)
    if not executable.exists():
        raise VoiceTypingFailure("not_configured")
    if not executable.is_file():
        raise VoiceTypingFailure("not_configured")
    if not os.access(executable, os.X_OK):
        raise VoiceTypingFailure("not_configured")
    return executable


def _read_data_file(path_file: Path) -> Path:
    data_file = _read_marker(path_file)
    if not data_file.exists():
        raise VoiceTypingFailure("not_configured")
    if not data_file.is_file():
        raise VoiceTypingFailure("not_configured")
    if not os.access(data_file, os.R_OK):
        raise VoiceTypingFailure("not_configured")
    return data_file


def _transcribe(wav_data: bytes) -> str:
    if len(wav_data) > 20 * 1024 * 1024:
        raise VoiceTypingFailure("invalid_recording")

    whisper = _read_executable(WHISPER_PATH_FILE)
    model = _read_data_file(MODEL_PATH_FILE)

    with tempfile.TemporaryDirectory(prefix="decky-whatsapp-voice-", dir=VOICE_ROOT) as temp_dir:
        temp_path = Path(temp_dir)
        audio_path = temp_path / "recording.wav"
        output_base = temp_path / "transcription"
        audio_path.write_bytes(wav_data)
        print(f"[voice] transcribing {len(wav_data)} bytes", flush=True)

        # Decky's bundled Python may expose an older temporary libstdc++ from
        # its PyInstaller environment. Whisper.cpp was compiled against the
        # SteamOS system library, so give the child process a clean library
        # path and remove any inherited preload override.
        process_env = os.environ.copy()
        process_env.pop("LD_PRELOAD", None)
        process_env["LD_LIBRARY_PATH"] = f"/usr/lib:{whisper.parent}"

        result = subprocess.run(
            [
                str(whisper),
                "-m", str(model),
                "-f", str(audio_path),
                "-l", "auto",
                "-nt",
                "-otxt",
                "-of", str(output_base),
            ],
            capture_output=True,
            text=True,
            env=process_env,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            raise VoiceTypingFailure("transcription_failed")

        transcript_path = output_base.with_suffix(".txt")
        if not transcript_path.is_file():
            raise VoiceTypingFailure("transcription_failed")
        transcript = transcript_path.read_text(encoding="utf-8").lstrip("\ufeff").strip()
        if not transcript:
            raise VoiceTypingFailure("no_speech")
        return transcript


# Expose Decky RPC entry points; transcription work runs on a worker thread.
class Plugin:
    async def _main(self):
        pass

    async def _unload(self):
        pass

    async def voice_typing_status(self):
        """Report whether the optional local Whisper installation is usable."""
        try:
            _read_executable(WHISPER_PATH_FILE)
            _read_data_file(MODEL_PATH_FILE)
            return {"available": True}
        except Exception:
            return {"available": False, "reason": "not_configured"}

    async def transcribe_audio(self, audio_base64: str) -> str:
        try:
            try:
                wav_data = base64.b64decode(audio_base64, validate=True)
            except (binascii.Error, ValueError):
                raise VoiceTypingFailure("invalid_recording")

            if not wav_data.startswith(b"RIFF") or wav_data[8:12] != b"WAVE":
                raise VoiceTypingFailure("invalid_recording")

            transcript = await asyncio.to_thread(_transcribe, wav_data)
            if not transcript:
                raise VoiceTypingFailure("transcription_failed")
            return transcript
        except VoiceTypingFailure as error:
            category = error.category
            print(f"[voice] transcription failed: {category}", flush=True)
            return f"__VOICE_ERROR__{category}"
        except Exception:
            print("[voice] transcription failed: transcription_failed", flush=True)
            return "__VOICE_ERROR__transcription_failed"
