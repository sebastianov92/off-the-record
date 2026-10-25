"""Word-timed transcription of the vocal stem with faster-whisper."""

import os
from collections.abc import Callable

import numpy as np

from pikaraoke.ai.audio import WHISPER_RATE

WHISPER_MODEL = os.environ.get("PIKARAOKE_WHISPER_MODEL", "large-v3-turbo")

_model = None


def cpu_threads() -> int:
    """Leave two cores free so playback and the web server never stutter."""
    return int(os.environ.get("PIKARAOKE_AI_THREADS", "0")) or max(1, (os.cpu_count() or 2) - 2)


def _whisper(models_dir: str | None = None):
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        # CTranslate2 has no Apple GPU backend; int8 on CPU is what the mini PC runs too.
        _model = WhisperModel(
            WHISPER_MODEL,
            device="cpu",
            compute_type="int8",
            cpu_threads=cpu_threads(),
            download_root=models_dir,
        )
    return _model


def detect_language(
    vocals16: np.ndarray, regions: list[tuple[float, float]], models_dir: str | None = None
) -> str:
    """Detect on the longest sung stretch: intros are usually instrumental."""
    start = 0
    if regions:
        longest = max(regions, key=lambda r: r[1] - r[0])
        start = int(longest[0] * WHISPER_RATE)
    clip = vocals16[start : start + 30 * WHISPER_RATE]
    language, _, _ = _whisper(models_dir).detect_language(clip)
    return language


def transcribe(
    vocals16: np.ndarray,
    language: str,
    progress: Callable[[float], None],
    models_dir: str | None = None,
) -> list[dict]:
    """Segments with per-word timings, shaped like openai-whisper's output."""
    duration = len(vocals16) / WHISPER_RATE
    # The whole track, never clipped to voice regions: windows that start mid-phrase
    # made Whisper skip whole verses. What it invents in silences, lyrics.py drops.
    segments, _ = _whisper(models_dir).transcribe(
        vocals16,
        language=language,
        word_timestamps=True,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
    )
    out = []
    for seg in segments:
        out.append(
            {
                "text": seg.text,
                "start": seg.start,
                "end": seg.end,
                "no_speech_prob": seg.no_speech_prob,
                "avg_logprob": seg.avg_logprob,
                "compression_ratio": seg.compression_ratio,
                "words": [
                    {"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                    for w in seg.words or []
                ],
            }
        )
        progress(min(1.0, seg.end / duration))
    return out
