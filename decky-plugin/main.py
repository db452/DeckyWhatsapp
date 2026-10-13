import asyncio
import base64
import binascii
import subprocess
import tempfile
import os
import traceback
from pathlib import Path


DEFAULT_VOICE_ROOT = Path.home() / ".local" / "share" / "decky-whatsapp" / "voice"
DECK_VOICE_ROOT = Path("/home/deck/.local/share/decky-whatsapp/voice")
VOICE_ROOT = DECK_VOICE_ROOT if DECK_VOICE_ROOT.exists() else DEFAULT_VOICE_ROOT
WHISPER_PATH_FILE = VOICE_ROOT / "whisper-cli.path"
MODEL_PATH_FILE = VOICE_ROOT / "model.path"


def _read_marker(path_file: Path) -> Path:
    if not path_file.is_file():
        raise RuntimeError(f"Voice typing marker is missing: {path_file} (home={Path.home()})")
    value = path_file.read_text(encoding="utf-8").strip()
    if not value:
        raise RuntimeError(f"Voice typing path is empty: {path_file}")
    return Path(value)


def _read_executable(path_file: Path) -> Path:
    executable = _read_marker(path_file)
    if not executable.exists():
        raise RuntimeError(f"Voice typing executable is missing: {executable}")
    if not executable.is_file():
        raise RuntimeError(f"Voice typing path is not a file: {executable}")
    if not os.access(executable, os.X_OK):
        raise RuntimeError(f"Voice typing file is not executable: {executable}")
    return executable


def _read_data_file(path_file: Path) -> Path:
    data_file = _read_marker(path_file)
    if not data_file.exists():
        raise RuntimeError(f"Voice typing model is missing: {data_file}")
    if not data_file.is_file():
        raise RuntimeError(f"Voice typing model path is not a file: {data_file}")
    if not os.access(data_file, os.R_OK):
        raise RuntimeError(f"Voice typing model is not readable: {data_file}")
    return data_file


def _process_output(result: subprocess.CompletedProcess[str]) -> str:
    lines = []
    for stream_name, stream in (("stdout", result.stdout), ("stderr", result.stderr)):
        if stream and stream.strip():
            lines.append(f"{stream_name}: {stream.strip()}")
    return "\n".join(lines)[-4000:]


def _transcribe(wav_data: bytes) -> str:
    if len(wav_data) > 20 * 1024 * 1024:
        raise RuntimeError("Recording is too large")

    whisper = _read_executable(WHISPER_PATH_FILE)
    model = _read_data_file(MODEL_PATH_FILE)

    with tempfile.TemporaryDirectory(prefix="decky-whatsapp-voice-", dir=VOICE_ROOT) as temp_dir:
        temp_path = Path(temp_dir)
        audio_path = temp_path / "recording.wav"
        output_base = temp_path / "transcription"
        audio_path.write_bytes(wav_data)
        print(f"[voice] transcribing {len(wav_data)} bytes with {whisper} and model {model}", flush=True)

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
            output = _process_output(result)
            raise RuntimeError(f"Whisper exited with code {result.returncode}: {output or 'no diagnostic output'}")

        transcript_path = output_base.with_suffix(".txt")
        if not transcript_path.is_file():
            output = _process_output(result)
            raise RuntimeError(f"Whisper produced no transcript at {transcript_path}: {output or 'no diagnostic output'}")
        transcript = transcript_path.read_text(encoding="utf-8").lstrip("\ufeff").strip()
        if not transcript:
            raise RuntimeError("No speech was detected; try speaking closer to the microphone")
        return transcript


class Plugin:
    async def _main(self):
        pass

    async def _unload(self):
        pass

    async def transcribe_audio(self, audio_base64: str) -> str:
        try:
            try:
                wav_data = base64.b64decode(audio_base64, validate=True)
            except (binascii.Error, ValueError) as error:
                raise RuntimeError("Invalid voice recording") from error

            if not wav_data.startswith(b"RIFF") or wav_data[8:12] != b"WAVE":
                raise RuntimeError("Voice recording must be a WAV file")

            transcript = await asyncio.to_thread(_transcribe, wav_data)
            if not transcript:
                raise RuntimeError("Whisper returned an empty transcription")
            return transcript
        except Exception as error:
            details = str(error).strip() or error.__class__.__name__
            print(f"[voice] transcription failed: {details}", flush=True)
            traceback.print_exc()
            return f"__VOICE_ERROR__{details}"
