"""Tests for turning Whisper's word timings into karaoke lines."""

import numpy as np
import pytest

lyrics = pytest.importorskip("pikaraoke.ai.lyrics")

FPS = lyrics.Envelope.FPS


def envelope(voiced: list[tuple[float, float]], seconds: float = 30.0) -> "lyrics.Envelope":
    """Vocal energy that is loud inside the given stretches and silent elsewhere."""
    db = np.full(int(seconds * FPS), -80.0)
    for start, end in voiced:
        db[int(start * FPS) : int(end * FPS)] = -10.0
    return lyrics.Envelope(db, threshold=-40.0)


def segment(words: list[tuple[str, float, float]]) -> dict:
    return {
        "text": " ".join(w for w, _, _ in words),
        "words": [{"word": f" {w}", "start": s, "end": e, "probability": 0.9} for w, s, e in words],
    }


def test_a_word_stretched_over_a_gap_starts_where_the_voice_returns():
    env = envelope([(1.0, 2.0), (6.0, 7.5)])
    seg = segment([("one", 1.0, 1.4), ("two", 1.4, 2.0), ("three", 2.0, 6.6), ("four", 6.6, 7.4)])

    lines = lyrics.build_lines([seg], 30.0, env)

    assert [line["text"] for line in lines] == ["One two", "Three four"]
    assert lines[1]["start"] == pytest.approx(6.0, abs=0.1)


def test_a_breath_breaks_the_line_even_with_blurred_timings():
    env = envelope([(1.0, 3.0), (3.5, 5.5)])
    words = [("a", 1.0, 1.5), ("b", 1.5, 2.0), ("c", 2.0, 3.2), ("d", 3.3, 4.0), ("e", 4.0, 5.0)]

    lines = lyrics.build_lines([segment(words)], 30.0, env)

    assert [line["text"] for line in lines] == ["A b c", "D e"]


def test_a_verse_split_across_whisper_segments_is_joined_again():
    env = envelope([(1.0, 3.0)])
    first = segment([("so", 1.0, 1.5), ("we", 1.5, 2.0)])
    second = segment([("sing", 2.0, 2.5), ("on", 2.5, 3.0)])

    lines = lyrics.build_lines([first, second], 30.0, env)

    assert [line["text"] for line in lines] == ["So we sing on"]


def test_no_line_exceeds_the_word_limit():
    words = [(f"w{i}", i * 0.4, i * 0.4 + 0.35) for i in range(107)]

    lines = lyrics.build_lines([segment(words)], 60.0)

    assert max(len(line["words"]) for line in lines) <= lyrics.MAX_WORDS
    assert sum(len(line["words"]) for line in lines) == 107
