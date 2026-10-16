import asyncio
import base64
import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main


class VoiceLoggingSecurityTests(unittest.TestCase):
    def test_whisper_output_is_not_logged_or_returned_on_failure(self):
        private_text = "SYNTHETIC_DICTATED_PRIVATE_TEXT_33a91"
        audio = b"RIFF\x00\x00\x00\x00WAVEsynthetic-audio"
        result = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout=private_text,
            stderr=f"decoder failed after: {private_text}",
        )

        async def transcribe():
            with tempfile.TemporaryDirectory() as voice_root:
                captured = io.StringIO()
                with (
                    patch.object(main, "VOICE_ROOT", Path(voice_root)),
                    patch.object(main, "_read_executable", return_value=Path("/fake/whisper")),
                    patch.object(main, "_read_data_file", return_value=Path("/fake/model")),
                    patch.object(main.subprocess, "run", return_value=result),
                    contextlib.redirect_stdout(captured),
                ):
                    response = await main.Plugin().transcribe_audio(base64.b64encode(audio).decode("ascii"))
                self.assertEqual(response, "__VOICE_ERROR__transcription_failed")
                self.assertNotIn(private_text, response)
                self.assertNotIn(private_text, captured.getvalue())

        asyncio.run(transcribe())


if __name__ == "__main__":
    unittest.main()
