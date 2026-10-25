"""Reference melody of the vocal stem (YIN), which the singer's pitch is scored against."""

import numpy as np

from pikaraoke.ai.audio import WHISPER_RATE, energy_db, voice_threshold

FPS = 50  # frames per second of the melody
FRAME = 1024  # analysis window (64 ms at 16 kHz): two periods of a low male voice
MIN_HZ, MAX_HZ = 70.0, 1000.0
THRESHOLD = 0.15  # YIN dip that counts as a period
SMOOTH = 5  # median over 100 ms knocks out single-frame octave slips


def _cmnd(frames: np.ndarray, tau_max: int) -> np.ndarray:
    """YIN's cumulative mean normalised difference for every frame at once."""
    w = frames.shape[1]
    spectrum = np.fft.rfft(frames, n=2 * w)
    acf = np.fft.irfft(spectrum * np.conj(spectrum))[:, : tau_max + 1]
    energy = np.cumsum(frames**2, axis=1)
    total = energy[:, -1:]
    taus = np.arange(tau_max + 1)
    head = total - np.concatenate([np.zeros((len(frames), 1)), energy[:, :-1]], axis=1)[:, taus]
    tail = energy[:, w - 1 - taus]
    diff = head + tail - 2 * acf
    diff[:, 0] = 0
    cumulative = np.cumsum(diff[:, 1:], axis=1)
    out = np.ones_like(diff)
    out[:, 1:] = diff[:, 1:] * taus[1:] / np.maximum(cumulative, 1e-12)
    return out


def melody(vocals16: np.ndarray, rate: int = WHISPER_RATE) -> list[float]:
    """Pitch of the lead vocal every 1/FPS s, as a MIDI note number (0 = not singing)."""
    hop = rate // FPS
    tau_min, tau_max = int(rate / MAX_HZ), int(rate / MIN_HZ)
    padded = np.concatenate([vocals16, np.zeros(FRAME, dtype=np.float32)])
    count = max(0, (len(vocals16)) // hop)
    db = energy_db(vocals16, FPS, rate)
    loud = db > voice_threshold(db)

    notes = np.zeros(count, dtype=np.float32)
    for start in range(0, count, 2000):
        idx = np.arange(start, min(count, start + 2000))
        frames = np.stack([padded[i * hop : i * hop + FRAME] for i in idx]).astype(np.float64)
        frames -= frames.mean(axis=1, keepdims=True)
        cmnd = _cmnd(frames, tau_max)
        for row, i in enumerate(idx):
            if i >= len(loud) or not loud[i]:
                continue
            curve = cmnd[row]
            below = np.nonzero(curve[tau_min:tau_max] < THRESHOLD)[0]
            if not len(below):
                continue
            tau = tau_min + below[0]
            while tau + 1 < tau_max and curve[tau + 1] < curve[tau]:
                tau += 1
            # Parabolic interpolation between neighbouring lags.
            a, b, c = curve[tau - 1], curve[tau], curve[tau + 1]
            shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) else 0.0
            hz = rate / (tau + shift)
            notes[i] = 69 + 12 * np.log2(hz / 440.0)

    smoothed = notes.copy()
    half = SMOOTH // 2
    for i in range(count):
        window = notes[max(0, i - half) : i + half + 1]
        voiced = window[window > 0]
        smoothed[i] = np.median(voiced) if notes[i] > 0 and len(voiced) else 0
    return [round(float(n), 1) for n in smoothed]
