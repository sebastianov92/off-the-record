"""Segmentos de Whisper -> líneas de karaoke, y escritura de LRC / ASS / JSON."""

import json
import re
from pathlib import Path

MAX_WORDS = 9
LINE_GAP = 1.1  # silencio (s) que corta una línea
FIRST_WORD_MAX = 1.6  # Whisper suele adelantar el inicio de la primera palabra tras un silencio

# Frases que Whisper inventa en pasajes instrumentales.
HALLUCINATIONS = re.compile(
    r"amara\.org|subt[ií]tul|gracias por ver|suscr[ií]b|thanks for watching|subscribe|"
    r"^\W*(m[uú]sica|music|applause|aplausos|risas)\W*$|♪",
    re.IGNORECASE,
)


class Envelope:
    """Energía de la voz aislada (dB cada 10 ms) para corregir los bordes de Whisper."""

    FPS = 100

    def __init__(self, db, threshold: float):
        self.db, self.threshold = db, threshold

    def _frame(self, t: float) -> int:
        return max(0, min(len(self.db) - 1, int(t * self.FPS)))

    def voiced(self, start: float, end: float) -> float:
        """Fracción de [start, end] con voz."""
        a = self._frame(start)
        b = max(a + 1, self._frame(end))
        frames = self.db[a:b]
        return float((frames > self.threshold).mean()) if len(frames) else 0.0

    def onset(self, start: float, end: float, skip_tail: bool = False) -> float | None:
        """Primer instante con voz dentro de [start, end].

        Con skip_tail, la voz que ya suena en `start` se toma como la cola de la palabra
        anterior y se busca la siguiente entrada después de un silencio.
        """
        a, b = self._frame(start), self._frame(end)
        if skip_tail:
            while a < b and self.db[a] > self.threshold:
                a += 1
            if a >= b:
                return None
        for i in range(a, b):
            if self.db[i] > self.threshold:
                return i / self.FPS
        return None

    def last_silence(self, start: float, end: float, min_seconds: float) -> float | None:
        """End of the last silence at least `min_seconds` long inside [start, end]."""
        a, b = self._frame(start), self._frame(end)
        run, found = 0, None
        for i in range(a, b):
            if self.db[i] > self.threshold:
                if run >= min_seconds * self.FPS:
                    found = i / self.FPS
                run = 0
            else:
                run += 1
        return found

    def release(self, end: float, limit: float) -> float:
        """Dónde se apaga realmente la voz después de `end`, sin pasar de `limit`."""
        i, b = self._frame(end), self._frame(limit)
        while i < b and self.db[i] > self.threshold:
            i += 1
        return max(end, i / self.FPS)


BREATH = 0.3  # a silence this long in the vocal stem is a breath between phrases


def _snap_to_voice(words: list[dict], env: Envelope) -> None:
    """Whisper sometimes starts a word before a breath, or stretches it across an
    instrumental gap; start it where the voice comes back."""
    for w in words:
        if w["e"] - w["s"] <= BREATH:
            continue
        back = env.last_silence(w["s"], w["e"], BREATH)
        if back is not None and back < w["e"] - 0.08:
            w["s"] = max(w["s"], back - 0.03)


def _clean_words(segment: dict) -> list[dict]:
    words = []
    for w in segment.get("words") or []:
        text = w.get("word", "").strip()
        if not text or not re.search(r"\w", text):
            continue
        start, end = float(w["start"]), float(w["end"])
        if end - start < 0.08:
            end = start + 0.08
        words.append({"t": text, "s": start, "e": end, "p": float(w.get("probability", 1.0))})
    return words


def _is_noise(segment: dict, words: list[dict], env: Envelope | None) -> bool:
    text = segment.get("text", "")
    if not words or HALLUCINATIONS.search(text):
        return True
    if segment.get("compression_ratio", 0) > 2.6:
        return True
    # Palabras donde la pista de voz está en silencio: Whisper las inventó.
    if env is not None and sum(env.voiced(w["s"], w["e"]) for w in words) / len(words) < 0.35:
        return True
    avg_prob = sum(w["p"] for w in words) / len(words)
    return segment.get("no_speech_prob", 0) > 0.7 and avg_prob < 0.4


def _balance(phrase: list[dict]) -> list[list[dict]]:
    """Parte una frase larga en trozos parejos, cortando donde haya más aire o una coma."""
    n = len(phrase)
    if n <= MAX_WORDS:
        return [phrase]
    parts = -(-n // MAX_WORDS)
    cuts, prev = [], 0
    for j in range(1, parts):
        # Aimed at an even share of what is left, never leaving a part over MAX_WORDS.
        ideal = prev + round((n - prev) / (parts - j + 1))
        lo = max(prev + 2, n - MAX_WORDS * (parts - j), ideal - 2)
        hi = min(prev + MAX_WORDS, n - 2, ideal + 2)
        if lo > hi:
            lo = max(prev + 2, n - MAX_WORDS * (parts - j))
            hi = min(prev + MAX_WORDS, n - 2)

        def score(i: int) -> float:
            gap = phrase[i]["s"] - phrase[i - 1]["e"]
            comma = 0.3 if phrase[i - 1]["t"][-1] in ",:" else 0
            return gap + comma - 0.05 * abs(i - ideal)

        best = max(range(lo, hi + 1), key=score) if lo <= hi else ideal
        cuts.append(best)
        prev = best
    bounds = [0, *cuts, n]
    return [phrase[a:b] for a, b in zip(bounds, bounds[1:])]


def _breath_between(first: dict, second: dict, env: Envelope) -> bool:
    """Silence in the vocal stem from the middle of one word to the middle of the next."""
    middle = lambda w: (w["s"] + w["e"]) / 2
    return env.last_silence(middle(first), middle(second), BREATH) is not None


def _split(words: list[dict], env: Envelope | None = None) -> list[list[dict]]:
    """Corta en silencios largos, respiros y signos de puntuación; las frases largas se reparten parejo."""
    phrases: list[list[dict]] = [[]]
    for w in words:
        cur = phrases[-1]
        if cur:
            gap = w["s"] - cur[-1]["e"]
            punct = cur[-1]["t"][-1] in ".!?;" and len(cur) >= 3
            # A breath the vocal stem really has, even when Whisper's timings blur it.
            breath = env is not None and len(cur) >= 3 and _breath_between(cur[-1], w, env)
            if gap > LINE_GAP or punct or breath:
                phrases.append(cur := [])
        cur.append(w)
    lines = [line for phrase in phrases if phrase for line in _balance(phrase)]
    # Evita colas de una sola palabra pegándolas a la línea anterior.
    merged: list[list[dict]] = []
    for line in lines:
        if (
            merged
            and len(line) == 1
            and line[0]["s"] - merged[-1][-1]["e"] < LINE_GAP
            and len(merged[-1]) < MAX_WORDS + 2
        ):
            merged[-1].extend(line)
        elif line:
            merged.append(line)
    return merged


def _fix_edges(line: list[dict], env: Envelope | None, next_start: float, prev_end: float) -> None:
    for i, w in enumerate(line):
        before = line[i - 1]["e"] if i else prev_end
        after_gap = i == 0 or w["s"] - before > 0.25
        if i == 0 and w["e"] - w["s"] > FIRST_WORD_MAX:
            w["s"] = w["e"] - FIRST_WORD_MAX
        if env is not None and after_gap:
            # Whisper suele cortar antes la palabra previa: lo que suena aquí puede ser su cola.
            on = env.onset(w["s"], w["e"], skip_tail=w["s"] - before < 0.3)
            if on is not None and on > w["s"]:
                w["s"] = min(on - 0.03, w["e"] - 0.08)
    if env is not None:
        last = line[-1]
        last["e"] = env.release(last["e"], min(last["e"] + 0.8, next_start - 0.05))


def _continues(before: list[dict], after: list[dict], env: Envelope | None) -> bool:
    """A Whisper segment boundary in mid-phrase: no gap, no breath, and room to join."""
    if len(before) + len(after) > MAX_WORDS:
        return False
    if after[0]["s"] - before[-1]["e"] >= 0.3:
        return False
    return env is None or not _breath_between(before[-1], after[0], env)


def build_lines(segments: list[dict], duration: float, env: Envelope | None = None) -> list[dict]:
    chunks: list[list[dict]] = []
    for seg in segments:
        words = _clean_words(seg)
        if env is not None:
            _snap_to_voice(words, env)
        if _is_noise(seg, words, env):
            continue
        for k, chunk in enumerate(_split(words, env)):
            if k == 0 and chunks and _continues(chunks[-1], chunk, env):
                chunks[-1].extend(chunk)
            else:
                chunks.append(chunk)
    chunks.sort(key=lambda c: c[0]["s"])

    lines = []
    for n, chunk in enumerate(chunks):
        next_start = chunks[n + 1][0]["s"] if n + 1 < len(chunks) else duration
        prev_end = chunks[n - 1][-1]["e"] if n else -1.0
        _fix_edges(chunk, env, next_start, prev_end)
        text = " ".join(w["t"] for w in chunk)
        lines.append(
            {
                "start": round(chunk[0]["s"], 3),
                "end": round(min(duration, chunk[-1]["e"]), 3),
                "text": text[:1].upper() + text[1:],
                "words": [
                    {"t": w["t"], "s": round(w["s"], 3), "e": round(w["e"], 3)} for w in chunk
                ],
            }
        )
    # Una línea no puede seguir activa cuando empieza la siguiente.
    for a, b in zip(lines, lines[1:]):
        if a["end"] > b["start"]:
            a["end"] = b["start"]
            a["words"][-1]["e"] = min(a["words"][-1]["e"], b["start"])
    return lines


def _lrc_time(t: float) -> str:
    t = max(0.0, t)
    m, s = divmod(t, 60)
    return f"{int(m):02d}:{s:05.2f}"


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    h, rest = divmod(t, 3600)
    m, s = divmod(rest, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def to_lrc(lines: list[dict], title: str, artist: str, duration: float, enhanced: bool) -> str:
    out = [f"[ti:{title}]"]
    if artist:
        out.append(f"[ar:{artist}]")
    out += [f"[length:{_lrc_time(duration)[:5]}]", "[re:PiKaraoke (Demucs + Whisper)]", ""]
    for i, line in enumerate(lines):
        if enhanced:
            words = " ".join(f"<{_lrc_time(w['s'])}>{w['t']}" for w in line["words"])
            out.append(f"[{_lrc_time(line['start'])}]{words} <{_lrc_time(line['end'])}>")
        else:
            out.append(f"[{_lrc_time(line['start'])}]{line['text']}")
        nxt = lines[i + 1]["start"] if i + 1 < len(lines) else None
        if nxt is None or nxt - line["end"] > 4:
            out.append(f"[{_lrc_time(line['end'] + 0.5)}]")
    return "\n".join(out) + "\n"


ASS_HEADER = """[Script Info]
Title: {title}
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Helvetica Neue,72,&H0000D7FF,&H00FFFFFF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

ASS_LEAD = 1.0  # la línea aparece un segundo antes de cantarse


def to_ass(lines: list[dict], title: str) -> str:
    out = [ASS_HEADER.format(title=title)]
    for line in lines:
        show = max(0.0, line["start"] - ASS_LEAD)
        cursor = show
        parts = []
        for w in line["words"]:
            if w["s"] > cursor:
                parts.append(f"{{\\k{round((w['s'] - cursor) * 100)}}}")
            parts.append(f"{{\\kf{max(1, round((w['e'] - w['s']) * 100))}}}{w['t']} ")
            cursor = w["e"]
        out.append(
            f"Dialogue: 0,{_ass_time(show)},{_ass_time(line['end'] + 0.4)},Karaoke,,0,0,0,,{''.join(parts).rstrip()}"
        )
    return "\n".join(out) + "\n"


def write_all(
    song_dir: Path, lines: list[dict], *, title: str, artist: str, language: str, duration: float
) -> None:
    doc = {
        "title": title,
        "artist": artist,
        "language": language,
        "duration": round(duration, 2),
        "lines": lines,
    }
    (song_dir / "lyrics.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    (song_dir / "lyrics.lrc").write_text(to_lrc(lines, title, artist, duration, enhanced=False))
    (song_dir / "lyrics.enhanced.lrc").write_text(
        to_lrc(lines, title, artist, duration, enhanced=True)
    )
    (song_dir / "lyrics.ass").write_text(to_ass(lines, title))
