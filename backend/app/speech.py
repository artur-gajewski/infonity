"""Local, serialized speech recognition. Audio stays in memory and is never saved."""
from io import BytesIO
from threading import Lock


class SpeechService:
    def __init__(self, model):
        self.model_path = model
        self.model = None
        self.lock = Lock()

    def transcribe(self, audio):
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio

        with self.lock:
            try:
                samples = decode_audio(BytesIO(audio), sampling_rate=16000)
            except Exception as exc:
                raise ValueError("Unable to decode this audio recording") from exc
            if len(samples) > 65 * 16000:
                raise ValueError("Recordings must be no longer than 60 seconds")
            if self.model is None:
                self.model = WhisperModel(
                    self.model_path, device="cpu", compute_type="int8",
                    cpu_threads=4, local_files_only=True,
                )
            segments, _ = self.model.transcribe(
                samples, language="en", beam_size=5, vad_filter=True,
                condition_on_previous_text=False, temperature=0,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()
