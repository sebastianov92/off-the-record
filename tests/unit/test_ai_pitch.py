"""Tests for the reference melody the singer is scored against."""

import numpy as np
import pytest

pitch = pytest.importorskip("pikaraoke.ai.pitch")

RATE = 16000


def tone(hz: float, seconds: float) -> np.ndarray:
    t = np.arange(int(RATE * seconds)) / RATE
    return (0.3 * np.sin(2 * np.pi * hz * t) + 0.1 * np.sin(4 * np.pi * hz * t)).astype(np.float32)


@pytest.mark.parametrize("hz, midi", [(110.0, 45), (220.0, 57), (440.0, 69), (659.25, 76)])
def test_a_steady_tone_reads_as_its_note(hz, midi):
    notes = np.array(pitch.melody(tone(hz, 2.0)))
    voiced = notes[notes > 0]
    assert len(voiced) > len(notes) * 0.8
    assert np.median(voiced) == pytest.approx(midi, abs=0.1)


def test_silence_is_not_singing():
    signal = np.concatenate([np.zeros(RATE, dtype=np.float32), tone(220.0, 1.0)])
    notes = pitch.melody(signal)
    first_second = notes[: pitch.FPS - 3]
    assert not any(first_second)
