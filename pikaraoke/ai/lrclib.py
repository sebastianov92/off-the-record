"""Published lyrics from LRCLIB (lrclib.net), the free community lyrics database.

Whisper hears the words of a dense mix wrong; the published lyrics are right. These
are fetched for the singer's own karaoke at home and never redistributed.
"""

import logging
import re
import time

import requests

from pikaraoke import VERSION

API = "https://lrclib.net/api"
USER_AGENT = f"OffTheRecord/{VERSION} (https://github.com/sebastianov92/off-the-record)"
TIMEOUT = 10
# A version more than this many seconds off the song is another cut (radio edit, live).
MAX_DURATION_GAP = 5.0

_TAG = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")


def parse_lrc(text: str) -> list[dict]:
    """LRC -> [{"time": seconds, "text": line}], sorted, blank lines kept as markers."""
    lines = []
    for raw in text.splitlines():
        tags = _TAG.findall(raw)
        if not tags:
            continue
        words = _TAG.sub("", raw).strip()
        for minutes, seconds in tags:
            lines.append({"time": int(minutes) * 60 + float(seconds), "text": words})
    return sorted(lines, key=lambda line: line["time"])


def parse_plain(text: str) -> list[dict]:
    return [{"time": None, "text": line.strip()} for line in text.splitlines() if line.strip()]


def _get(path: str, params: dict) -> requests.Response:
    for attempt in range(2):
        response = requests.get(
            f"{API}/{path}", params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
        )
        # "Server busy" passes in a moment; one retry covers it.
        if response.status_code != 503 or attempt:
            return response
        time.sleep(2)
    return response


def _list(response: requests.Response) -> list[dict]:
    if response.status_code != 200:
        return []
    data = response.json()
    return data if isinstance(data, list) else [data]


def _choose(candidates: list[dict], duration: float) -> dict | None:
    """Synced lyrics first, then the version whose length is closest to the song's."""
    usable = [
        c
        for c in candidates
        if not c.get("instrumental")
        and (c.get("syncedLyrics") or c.get("plainLyrics"))
        and abs((c.get("duration") or 0) - duration) <= MAX_DURATION_GAP
    ]
    if not usable:
        return None
    return min(usable, key=lambda c: (not c.get("syncedLyrics"), abs(c["duration"] - duration)))


def find(artist: str, title: str, duration: float) -> dict | None:
    """Lyrics for a song: {"lines", "synced", "source_id", "duration"} or None."""
    if not title:
        return None
    # Exact match first, then by artist and title, then free text: each wider than the last.
    lookups = [
        ("get", {"artist_name": artist, "track_name": title, "duration": round(duration)}),
        ("search", {"artist_name": artist, "track_name": title}),
        ("search", {"q": f"{artist} {title}".strip()}),
    ]
    candidates: list[dict] = []
    try:
        for path, params in lookups:
            if path == "get" and not artist:
                continue
            candidates += _list(_get(path, params))
            if _choose(candidates, duration):
                break
    except (requests.RequestException, ValueError) as e:
        logging.warning(f"LRCLIB lookup failed for {artist} - {title}: {e}")
        return None
    best = _choose(candidates, duration)
    if not best:
        return None
    synced = bool(best.get("syncedLyrics"))
    lines = parse_lrc(best["syncedLyrics"]) if synced else parse_plain(best["plainLyrics"])
    return {
        "lines": lines,
        "synced": synced,
        "source_id": best.get("id"),
        "duration": best["duration"],
    }
