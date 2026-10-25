"""The beats of a song, so the singer's avatar on the TV can move to them.

Onset strength is the spectral flux of the instrumental; the tempo is the
autocorrelation peak of that strength, weighted toward 120 BPM so a song is not
read at half or double speed; the beats are then placed by dynamic programming
(Ellis, "Beat Tracking by Dynamic Programming", 2007): each beat sits on a strong
onset roughly one period after the one before it.
"""

import json
import os

import numpy as np

RATE = 22050  # analysis sample rate: drums and bass need no more
HOP = 512
N_FFT = 2048
MIN_BPM = 70.0
MAX_BPM = 180.0
PRIOR_BPM = 120.0
PRIOR_OCTAVES = 1.0  # how far from PRIOR_BPM a tempo may sit before it is doubted
TIGHTNESS = 100.0  # how strongly beats keep to one period


def onset_strength(y: np.ndarray) -> np.ndarray:
    """Spectral flux per hop: how much new energy each frame brings, normalised."""
    if len(y) < N_FFT:
        return np.zeros(0, dtype=np.float32)
    window = np.hanning(N_FFT).astype(np.float32)
    count = 1 + (len(y) - N_FFT) // HOP
    flux = np.zeros(count, dtype=np.float32)
    previous = None
    # In chunks: a whole song's frames at once would hold hundreds of megabytes.
    for start in range(0, count, 1024):
        idx = np.arange(start, min(count, start + 1024))[:, None] * HOP + np.arange(N_FFT)
        spectrum = np.log1p(10 * np.abs(np.fft.rfft(y[idx] * window, axis=1)))
        if previous is not None:
            spectrum = np.vstack([previous, spectrum])
        rise = np.maximum(0.0, np.diff(spectrum, axis=0)).sum(axis=1)
        offset = start if previous is not None else start + 1
        flux[offset : offset + len(rise)] = rise
        previous = spectrum[-1:]
    # Remove the slow swell of loudness so only attacks remain.
    trend = np.convolve(flux, np.ones(43) / 43, mode="same")
    flux = np.maximum(0.0, flux - trend)
    std = flux.std()
    return flux / std if std > 0 else flux


def tempo(onset: np.ndarray, fps: float) -> float:
    """Beats per minute from the onset strength's autocorrelation."""
    lags = np.arange(int(fps * 60 / MAX_BPM), int(fps * 60 / MIN_BPM) + 1)
    if len(onset) <= lags[-1]:
        return PRIOR_BPM
    n = len(onset)
    spectrum = np.fft.rfft(onset, 2 * n)
    corr = np.fft.irfft(spectrum * np.conj(spectrum))[: lags[-1] + 2]
    bpm = 60 * fps / lags
    prior = np.exp(-0.5 * (np.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2)
    best = int(lags[np.argmax(corr[lags] * prior)])
    # A parabola through the peak and its neighbours finds the lag between frames.
    a, b, c = corr[best - 1], corr[best], corr[best + 1]
    shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
    return float(60 * fps / (best + np.clip(shift, -0.5, 0.5)))


def track(onset: np.ndarray, fps: float, bpm: float) -> np.ndarray:
    """Frame indices of the beats, each one period-ish after the last on a strong onset."""
    period = 60 * fps / bpm
    if len(onset) < 2 * period:
        return np.zeros(0, dtype=int)
    width = max(1, int(period / 16))
    kernel = np.exp(-0.5 * (np.arange(-2 * width, 2 * width + 1) / width) ** 2)
    local = np.convolve(onset, kernel, mode="same")

    near, far = int(round(period / 2)), int(round(2 * period))
    offsets = np.arange(-far, -near + 1)
    penalty = -TIGHTNESS * np.log(-offsets / period) ** 2
    score = local.copy()
    back = np.full(len(onset), -1)
    for i in range(far, len(onset)):
        candidates = score[i + offsets] + penalty
        k = int(np.argmax(candidates))
        if candidates[k] > 0:
            score[i] += candidates[k]
            back[i] = i + offsets[k]

    # End on the strongest late peak, then follow the chain back to the start.
    tail = score[-int(2 * period) :]
    last = len(onset) - len(tail) + int(np.argmax(tail))
    beats = [last]
    while back[beats[-1]] >= 0:
        beats.append(int(back[beats[-1]]))
    beats = np.array(beats[::-1])
    # Beats before the music starts or after it stops ride on silence: drop them.
    loud = local[beats] > 0.1 * np.median(local[beats])
    return beats[loud]


def find(y: np.ndarray) -> dict:
    """{"tempo": bpm, "beats": [seconds]} for mono audio at RATE."""
    onset = onset_strength(y)
    fps = RATE / HOP
    if len(onset) == 0:
        return {"tempo": 0.0, "beats": []}
    bpm = tempo(onset, fps)
    frames = track(onset, fps, bpm)
    # A frame's attack sits at the centre of its window.
    times = (frames * HOP + N_FFT / 2) / RATE
    return {"tempo": round(bpm, 1), "beats": [round(float(t), 3) for t in times]}


def write_beats(out_dir: str, y: np.ndarray) -> None:
    with open(os.path.join(out_dir, "beats.json"), "w", encoding="utf-8") as f:
        json.dump(find(y), f)
