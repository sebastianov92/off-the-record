"""Tests for timing published lyrics with Whisper's word timings.

The lyrics here are made up for the tests.
"""

import pytest

align = pytest.importorskip("pikaraoke.ai.align")
lrclib = pytest.importorskip("pikaraoke.ai.lrclib")


def heard(words: list[tuple[str, float, float]]) -> list[dict]:
    """Whisper's output as one segment of timed words."""
    return [
        {
            "words": [
                {"word": f" {w}", "start": s, "end": e, "probability": 0.9} for w, s, e in words
            ]
        }
    ]


def reference(lines: list[tuple[float | None, str]], synced: bool = True) -> dict:
    return {"lines": [{"time": t, "text": text} for t, text in lines], "synced": synced}


class TestSound:
    def test_spelling_slips_sound_the_same(self):
        assert align.sound("Vez") == align.sound("bes")
        assert align.sound("llamo") == align.sound("yamo")
        assert align.sound("hola") == align.sound("ola")
        assert align.sound("Corazón,") == align.sound("corason")

    def test_different_words_stay_different(self):
        assert align.sound("luna") != align.sound("lana")


class TestParseLrc:
    def test_lines_sorted_and_repeated_tags_expanded(self):
        lines = lrclib.parse_lrc("[00:10.50]first line\n[00:05.00][00:20.00]chorus\n[00:30.00]\n")
        assert [(round(l["time"], 2), l["text"]) for l in lines] == [
            (5.0, "chorus"),
            (10.5, "first line"),
            (20.0, "chorus"),
            (30.0, ""),
        ]


class TestAlign:
    def test_published_words_take_whisper_timings(self):
        ref = reference([(None, "La rosa canta bajo el sol")], synced=False)
        # Whisper misheard two words; the rest anchor the line.
        segs = heard(
            [
                ("la", 1.0, 1.2),
                ("rosa", 1.2, 1.6),
                ("santa", 1.6, 2.0),
                ("bajo", 2.0, 2.4),
                ("el", 2.4, 2.5),
                ("sol", 2.5, 3.0),
            ]
        )

        lines, stats = align.align(ref, segs, None, 30.0)

        assert lines[0]["text"] == "La rosa canta bajo el sol"
        words = lines[0]["words"]
        assert words[1]["s"] == pytest.approx(1.2)
        assert words[2]["s"] == pytest.approx(1.6, abs=0.05)  # filled between anchors
        assert stats["match"] == pytest.approx(5 / 6, abs=0.01)

    def test_synced_lyrics_correct_the_global_offset(self):
        # The published version starts 2 s later than this recording.
        ref = reference(
            [
                (12.0, "uno dos tres"),
                (16.0, "cuatro cinco seis"),
                (20.0, "siete ocho nueve"),
                (24.0, "diez once doce"),
            ]
        )
        segs = heard(
            [
                ("uno", 10.0, 10.4),
                ("dos", 10.4, 10.8),
                ("tres", 10.8, 11.2),
                ("cuatro", 14.0, 14.4),
                ("cinco", 14.4, 14.8),
                ("seis", 14.8, 15.2),
                ("siete", 18.0, 18.4),
                ("ocho", 18.4, 18.8),
                ("nueve", 18.8, 19.2),
            ]
        )

        lines, stats = align.align(ref, segs, None, 40.0)

        assert stats["offset"] == pytest.approx(-2.0)
        # The last line was never heard: its published time, shifted, places it.
        assert lines[3]["start"] == pytest.approx(22.0, abs=0.01)

    def test_a_repeated_chorus_keeps_each_anchor_in_its_line(self):
        ref = reference([(5.0, "ven conmigo"), (10.0, "mar azul"), (15.0, "ven conmigo")])
        segs = heard(
            [
                ("mar", 10.0, 10.4),
                ("azul", 10.4, 10.9),
                ("ven", 15.0, 15.3),
                ("conmigo", 15.3, 16.0),
            ]
        )

        lines, _ = align.align(ref, segs, None, 30.0)

        assert lines[0]["start"] < 6.0  # not dragged to the chorus heard at 15 s
        assert lines[2]["start"] == pytest.approx(15.0)

    def test_unrelated_unsynced_lyrics_are_rejected(self):
        ref = reference(
            [(None, "nada que ver con esto"), (None, "otra cancion distinta")], synced=False
        )
        segs = heard([("la", 1.0, 1.2), ("rosa", 1.2, 1.6), ("canta", 1.6, 2.0)])

        assert align.align(ref, segs, None, 30.0) is None


class TestChoose:
    def test_prefers_synced_then_closest_length(self):
        candidates = [
            {"id": 1, "duration": 190.0, "plainLyrics": "x", "syncedLyrics": None},
            {"id": 2, "duration": 195.0, "plainLyrics": "x", "syncedLyrics": "[00:01.00]x"},
            {"id": 3, "duration": 191.0, "plainLyrics": "x", "syncedLyrics": "[00:01.00]x"},
            {"id": 4, "duration": 240.0, "plainLyrics": "x", "syncedLyrics": "[00:01.00]x"},
        ]
        assert lrclib._choose(candidates, 189.0)["id"] == 3
