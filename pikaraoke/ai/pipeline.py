"""One song in, karaoke out: stems, word-timed lyrics and their subtitle files."""

import json
import os
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np

from pikaraoke.ai import (
    align,
    audio,
    beats,
    lrclib,
    lyrics,
    pitch,
    separate,
    transcribe,
)
from pikaraoke.ai.store import NO_VOCALS, READY

# Share of the total time each step takes, so one progress bar covers them all.
_SPANS = {
    "separating": (0, 50),
    "saving": (50, 53),
    "language": (53, 55),
    "transcribing": (55, 97),
    "writing": (97, 100),
}

# A lead vocal sits within ~10 dB of the mix; a karaoke track's leftover backing
# vocals or bleed sit far below.
_NO_VOCALS_DB = -22.0


def _vocal_level_db(vocals: np.ndarray, mix: np.ndarray) -> float:
    rms = lambda x: float(np.sqrt(np.mean(np.square(x))) + 1e-9)
    return 20 * np.log10(rms(vocals) / rms(mix))


def write_beats(out_dir: str) -> None:
    """The instrumental's beats, which the singer's avatar on the TV moves to."""
    y = audio.decode(os.path.join(out_dir, "instrumental.m4a"), beats.RATE, 1)[0]
    beats.write_beats(out_dir, y)


def write_melody(out_dir: str, vocals16: np.ndarray) -> None:
    """The reference melody the singer is scored against (pitch.json)."""
    with open(os.path.join(out_dir, "pitch.json"), "w", encoding="utf-8") as f:
        json.dump({"fps": pitch.FPS, "notes": pitch.melody(vocals16)}, f, separators=(",", ":"))


def timed_lyrics(
    out_dir: str,
    segments: list[dict],
    vocals16: np.ndarray,
    duration: float,
    artist: str,
    title: str,
) -> tuple[list[dict], dict]:
    """Published lyrics timed by Whisper when LRCLIB has them; Whisper's own words if not."""
    db = audio.energy_db(vocals16, lyrics.Envelope.FPS)
    env = lyrics.Envelope(db, audio.voice_threshold(db))
    reference = lrclib.find(artist, title, duration)
    if reference:
        # Kept to re-time later without asking LRCLIB again.
        with open(os.path.join(out_dir, "reference.json"), "w", encoding="utf-8") as f:
            json.dump(reference, f, ensure_ascii=False)
        aligned = align.align(reference, segments, env, duration)
        if aligned:
            lines, stats = aligned
            return lines, {"lyrics_source": "lrclib", "lyrics_match": stats["match"]}
    return lyrics.build_lines(segments, duration, env), {
        "lyrics_source": "whisper",
        "lyrics_match": None,
    }


def refresh_lyrics(out_dir: str, artist: str, title: str, language: str) -> dict:
    """Look for published lyrics again for a song already processed; no re-transcribing."""
    with open(os.path.join(out_dir, "transcript.json"), encoding="utf-8") as f:
        segments = json.load(f)
    vocals16 = audio.decode(os.path.join(out_dir, "vocals.m4a"), audio.WHISPER_RATE, 1)[0]
    duration = len(vocals16) / audio.WHISPER_RATE
    lines, source = timed_lyrics(out_dir, segments, vocals16, duration, artist, title)
    lyrics.write_all(
        Path(out_dir), lines, title=title, artist=artist, language=language or "", duration=duration
    )
    return {"lines": len(lines), **source}


def process(
    song_path: str,
    out_dir: str,
    progress: Callable[[str, float], None],
    describe: Callable[[], tuple[str, str]],
    language: str | None = None,
    models_dir: str | None = None,
) -> dict:
    """Writes instrumental.m4a, vocals.m4a and the lyrics files; returns the ai_songs fields.

    describe() gives (artist, title) when the lyrics are looked up: metadata usually
    arrives while the vocals are still being separated.
    """
    started = time.time()

    def step(stage: str) -> Callable[[float], None]:
        """Progress callback for one stage, mapped onto the stage's share of 0-100."""
        lo, hi = _SPANS[stage]
        return lambda fraction: progress(stage, lo + (hi - lo) * fraction)

    mix = audio.decode(song_path, audio.SAMPLE_RATE, 2)
    duration = mix.shape[1] / audio.SAMPLE_RATE
    vocals, instrumental = separate.separate(mix, step("separating"))

    step("saving")(0)
    audio.encode_m4a(instrumental, os.path.join(out_dir, "instrumental.m4a"))
    write_beats(out_dir)
    audio.encode_m4a(vocals, os.path.join(out_dir, "vocals.m4a"))
    level = _vocal_level_db(vocals, mix)
    result = {"duration": round(duration, 2), "language": None, "lines": 0}
    if level < _NO_VOCALS_DB:
        return {**result, "status": NO_VOCALS, "seconds": round(time.time() - started, 1)}

    vocals16 = audio.decode(os.path.join(out_dir, "vocals.m4a"), audio.WHISPER_RATE, 1)[0]
    step("language")(0)
    if not language:
        language = transcribe.detect_language(vocals16, audio.voice_regions(vocals16), models_dir)
    segments = transcribe.transcribe(vocals16, language, step("transcribing"), models_dir)

    step("writing")(0)
    with open(os.path.join(out_dir, "transcript.json"), "w", encoding="utf-8") as f:
        json.dump(segments, f, ensure_ascii=False)
    write_melody(out_dir, vocals16)
    artist, title = describe()
    lines, source = timed_lyrics(out_dir, segments, vocals16, duration, artist, title)
    lyrics.write_all(
        Path(out_dir), lines, title=title, artist=artist, language=language, duration=duration
    )
    return {
        **result,
        **source,
        "status": READY,
        "language": language,
        "lines": len(lines),
        "seconds": round(time.time() - started, 1),
    }
