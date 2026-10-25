"""Published lyrics, timed word by word with Whisper's ears.

Whisper's words can be wrong but its timings are good where it heard right. Words of
the published lyrics that sound like what Whisper heard take its times (anchors); the
rest are spread between anchors by length and snapped to the voice. Synced lyrics add
a start time per line, which fixes the global offset and keeps anchors in their line.
"""

import difflib
import re
import statistics

from pikaraoke.ai.lyrics import MAX_WORDS, Envelope, _balance, _clean_words, _fix_edges
from pikaraoke.catalog.artists import fold

MIN_MATCH = 0.3  # share of unsynced lyrics Whisper must have heard to trust the timings
LINE_SLACK = 2.0  # an anchor may sit this far outside its synced line (seconds)
WORD_SECONDS = 0.35  # length of a word when nothing else says
MAX_WORD_SECONDS = 0.8  # past this a filler word is spreading over an instrumental
MIN_WORD = 0.12
LONG_LINE = MAX_WORDS + 3  # published lines longer than this are split


def sound(word: str) -> str:
    """Roughly how a Spanish or English word sounds, so spelling slips still match."""
    w = re.sub(r"[^a-z0-9]", "", fold(word))
    w = w.replace("ch", "X").replace("ll", "y").replace("qu", "k")
    w = re.sub(r"c(?=[ei])", "s", w).replace("c", "k").replace("z", "s").replace("v", "b")
    w = w.replace("h", "").replace("X", "ch")
    return re.sub(r"(.)\1+", r"\1", w)


def _offset(lines: list[dict], tokens: list[tuple], anchors: dict, heard: list[dict]) -> float:
    """Median shift between the published line times and where Whisper heard them start."""
    shifts = []
    for index, (line_no, _, _) in enumerate(tokens):
        first = index == 0 or tokens[index - 1][0] != line_no
        if first and index in anchors and lines[line_no]["time"] is not None:
            shifts.append(heard[anchors[index]]["s"] - lines[line_no]["time"])
    return statistics.median(shifts) if len(shifts) >= 3 else 0.0


def _fill(
    starts: list, ends: list, weights: list[int], env: Envelope | None, duration: float
) -> None:
    """Give every word without a time one, spread between its timed neighbours."""
    n = len(starts)
    i = 0
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        j = i
        while j < n and starts[j] is None:
            j += 1
        left = (
            ends[i - 1]
            if i and ends[i - 1] is not None
            else (starts[i - 1] + WORD_SECONDS if i else 0.0)
        )
        right = starts[j] if j < n else min(duration, left + WORD_SECONDS * (j - i) * 2)
        if right - left > MAX_WORD_SECONDS * (j - i) and env is not None:
            # A long gap is probably instrumental: start where the voice comes in.
            left = env.onset(left, right) or left
            right = min(right, left + WORD_SECONDS * (j - i) * 1.5)
        total = sum(weights[i:j]) or 1
        cursor = left
        for k in range(i, j):
            share = (right - left) * weights[k] / total
            starts[k], ends[k] = cursor, cursor + max(MIN_WORD, share)
            cursor += share
        i = j
    for k in range(n):
        if ends[k] is None:
            ends[k] = starts[k] + WORD_SECONDS
        if k + 1 < n and ends[k] > starts[k + 1]:
            ends[k] = max(starts[k] + MIN_WORD * 0.5, starts[k + 1])


def align(
    reference: dict, segments: list[dict], env: Envelope | None, duration: float
) -> tuple[list[dict], dict] | None:
    """Timed karaoke lines from published lyrics, or None if they do not fit the audio."""
    lines = [line for line in reference["lines"] if line["text"]]
    synced = reference["synced"]
    tokens = [
        (line_no, word, sound(word))
        for line_no, line in enumerate(lines)
        for word in line["text"].split()
        if sound(word)
    ]
    if not tokens:
        return None
    heard = sorted((w for seg in segments for w in _clean_words(seg)), key=lambda w: w["s"])
    matcher = difflib.SequenceMatcher(
        None, [t[2] for t in tokens], [sound(w["t"]) for w in heard], autojunk=False
    )
    anchors = {a + k: b + k for a, b, size in matcher.get_matching_blocks() for k in range(size)}

    offset = _offset(lines, tokens, anchors, heard) if synced else 0.0
    if synced:
        # A chorus heard elsewhere in the song is not this line's anchor.
        times = [line["time"] + offset for line in lines] + [duration + LINE_SLACK]
        for index in list(anchors):
            line_no = tokens[index][0]
            t = heard[anchors[index]]["s"]
            if not times[line_no] - LINE_SLACK <= t <= times[line_no + 1] + LINE_SLACK:
                del anchors[index]

    match = len(anchors) / len(tokens)
    if not synced and match < MIN_MATCH:
        return None

    starts = [None] * len(tokens)
    ends = [None] * len(tokens)
    for index, h in anchors.items():
        starts[index], ends[index] = heard[h]["s"], heard[h]["e"]
    if synced:
        for index, (line_no, _, _) in enumerate(tokens):
            if (index == 0 or tokens[index - 1][0] != line_no) and starts[index] is None:
                starts[index] = max(0.0, lines[line_no]["time"] + offset)
    # Anchors out of order (a word heard twice) would make time run backwards.
    last = 0.0
    for index in range(len(tokens)):
        if starts[index] is not None:
            if starts[index] < last:
                starts[index] = ends[index] = None
            else:
                last = starts[index]
    _fill(starts, ends, [len(t[1]) for t in tokens], env, duration)

    grouped: dict[int, list[dict]] = {}
    for index, (line_no, word, _) in enumerate(tokens):
        grouped.setdefault(line_no, []).append({"t": word, "s": starts[index], "e": ends[index]})
    chunks = []
    for line_no in sorted(grouped):
        words = grouped[line_no]
        chunks += _balance(words) if len(words) > LONG_LINE else [words]

    out = []
    for n, words in enumerate(chunks):
        next_start = chunks[n + 1][0]["s"] if n + 1 < len(chunks) else duration
        prev_end = chunks[n - 1][-1]["e"] if n else -1.0
        if env is not None:
            _fix_edges(words, env, next_start, prev_end)
        out.append(
            {
                "start": round(words[0]["s"], 3),
                "end": round(min(duration, words[-1]["e"]), 3),
                "text": " ".join(w["t"] for w in words),
                "words": [
                    {"t": w["t"], "s": round(w["s"], 3), "e": round(w["e"], 3)} for w in words
                ],
            }
        )
    for a, b in zip(out, out[1:]):
        if a["end"] > b["start"]:
            a["end"] = b["start"]
            a["words"][-1]["e"] = min(a["words"][-1]["e"], b["start"])
    return out, {"match": round(match, 2), "offset": round(offset, 2), "synced": synced}
