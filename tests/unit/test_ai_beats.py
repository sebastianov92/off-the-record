"""Tests for finding a song's beats, on click tracks whose beats are known."""

import numpy as np
import pytest

from pikaraoke.ai import beats


def click_track(bpm: float, seconds: float = 30.0, start: float = 1.0) -> tuple[np.ndarray, list]:
    """A kick and a noise burst on every beat, faint noise between them."""
    rng = np.random.default_rng(0)
    y = 0.01 * rng.standard_normal(int(seconds * beats.RATE)).astype(np.float32)
    burst = np.arange(int(0.06 * beats.RATE)) / beats.RATE
    hit = (np.sin(2 * np.pi * 60 * burst) + 0.5 * rng.standard_normal(len(burst))) * np.exp(
        -burst * 60
    )
    times = list(np.arange(start, seconds - 0.5, 60 / bpm))
    for t in times:
        i = int(t * beats.RATE)
        y[i : i + len(hit)] += hit.astype(np.float32)
    return y, times


@pytest.mark.parametrize("bpm", [120, 90])
def test_finds_the_tempo(bpm):
    y, _ = click_track(bpm)

    assert beats.find(y)["tempo"] == pytest.approx(bpm, abs=2)


@pytest.mark.parametrize("bpm", [120, 90])
def test_puts_the_beats_on_the_clicks(bpm):
    y, clicks = click_track(bpm)

    found = beats.find(y)["beats"]

    assert len(found) >= 0.9 * len(clicks)
    misses = [min(abs(b - c) for c in clicks) for b in found]
    assert np.median(misses) < 0.03
    assert np.median(np.diff(found)) == pytest.approx(60 / bpm, abs=0.02)


def test_silence_has_no_beats():
    assert beats.find(np.zeros(beats.RATE * 10, dtype=np.float32))["beats"] == []
