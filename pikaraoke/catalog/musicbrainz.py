"""Artist identity, aliases and original release year from MusicBrainz.

iTunes often matches a reissue (a 2020 compilation for a 2003 song) and has no notion
of one artist spelled many ways; MusicBrainz has both. Its rules: at most one request
per second and a User-Agent that says who is asking.
"""

import difflib
import logging
import time

import requests

from pikaraoke import VERSION
from pikaraoke.catalog.artists import fold

API = "https://musicbrainz.org/ws/2"
COVERS = "https://coverartarchive.org/release"
USER_AGENT = f"OffTheRecord/{VERSION} ( https://github.com/sebastianov92/off-the-record )"
TIMEOUT = 10
MIN_INTERVAL = 1.1  # seconds between requests
MIN_SCORE = 85  # MusicBrainz's own 0-100 search score
# Music videos run longer or shorter than the album cut; beyond this it is another song.
MAX_LENGTH_GAP = 20.0

_last_request = 0.0


RETRIES = 3  # MusicBrainz answers 503 when it is busy or asked too fast


def _get(path: str, params: dict) -> dict | None:
    global _last_request
    for attempt in range(RETRIES):
        wait = MIN_INTERVAL * (attempt + 1) - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        try:
            response = requests.get(
                f"{API}/{path}",
                params={**params, "fmt": "json"},
                headers={"User-Agent": USER_AGENT},
                timeout=TIMEOUT,
            )
            if response.status_code == 503:
                continue
            return response.json() if response.status_code == 200 else None
        except (requests.RequestException, ValueError) as e:
            logging.warning(f"MusicBrainz request failed ({path}): {e}")
            return None
    logging.warning(f"MusicBrainz stayed busy ({path})")
    return None


def _quote(text: str) -> str:
    return text.replace('"', " ").replace("\\", " ").strip()


def find_recording(artist: str, title: str, duration: float | None) -> dict | None:
    """The recording a song is: its artist id and name, original year and a release id."""
    if not artist or not title:
        return None
    data = _get(
        "recording/",
        {"query": f'recording:"{_quote(title)}" AND artist:"{_quote(artist)}"', "limit": 15},
    )
    if not data:
        return None
    candidates = []
    for rec in data.get("recordings", []):
        if rec.get("score", 0) < MIN_SCORE:
            continue
        if difflib.SequenceMatcher(None, fold(rec.get("title", "")), fold(title)).ratio() < 0.8:
            continue
        length = (rec.get("length") or 0) / 1000
        if duration and length and abs(length - duration) > MAX_LENGTH_GAP:
            continue
        credit = rec.get("artist-credit") or [{}]
        first = credit[0].get("artist", {})
        if not first.get("id"):
            continue
        year = (rec.get("first-release-date") or "")[:4]
        releases = rec.get("releases") or []
        candidates.append(
            {
                "artist_mbid": first["id"],
                "artist_name": first.get("name", ""),
                "year": int(year) if year.isdigit() else None,
                "release_mbid": releases[0]["id"] if releases else None,
            }
        )
    if not candidates:
        return None
    # The earliest release of the recording is the song's own year.
    dated = [c for c in candidates if c["year"]]
    return min(dated, key=lambda c: c["year"]) if dated else candidates[0]


def artist_aliases(mbid: str) -> list[str]:
    """Every spelling MusicBrainz knows for an artist, its own name included."""
    data = _get(f"artist/{mbid}", {"inc": "aliases"})
    if not data:
        return []
    return [data.get("name", "")] + [a.get("name", "") for a in data.get("aliases", [])]


def cover_url(release_mbid: str) -> str:
    return f"{COVERS}/{release_mbid}/front-250"
