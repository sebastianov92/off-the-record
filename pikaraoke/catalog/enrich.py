"""Metadata for one song: its tags or filename, confirmed against iTunes."""

import json
import logging
import os
import subprocess
import urllib.error
import urllib.request

from pikaraoke.catalog import musicbrainz
from pikaraoke.catalog.artists import is_single_name, split_credit
from pikaraoke.catalog.store import MANUAL, MATCHED, REVIEW, CatalogStore, covers_dir
from pikaraoke.lib.ffmpeg import get_media_duration
from pikaraoke.lib.metadata_providers import MetadataProvider, suggest_metadata

# suggest_metadata scores 0-100; below this the match is shown but left for review.
CONFIDENT = 75


def file_tags(path: str) -> dict:
    """Artist/title/album/date/genre tags of an uploaded file ({} when it has none)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", path],
            capture_output=True,
            check=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as e:
        logging.warning(f"Could not read tags of {path}: {e}")
        return {}
    tags = json.loads(out.stdout).get("format", {}).get("tags", {})
    return {k.lower(): v.strip() for k, v in tags.items() if isinstance(v, str)}


def guess_from_name(name: str) -> tuple[str, str]:
    """ "Artist - Title" -> (artist, title); a name without the dash is all title."""
    artist, sep, title = name.partition(" - ")
    return (artist.strip(), title.strip()) if sep else ("", name.strip())


def enrich_song(
    store: CatalogStore, song_id: int, path: str, display_name: str, provider: MetadataProvider
) -> str:
    """Fill in a song's metadata and artists; returns the resulting metadata status."""
    current = store.song(song_id)
    if current and current["metadata_status"] == MANUAL:
        return MANUAL
    tags = file_tags(path)
    if tags.get("artist") and tags.get("title"):
        query = f"{tags['artist']} - {tags['title']}"
    else:
        query = display_name
    try:
        suggestions = suggest_metadata(query, provider, limit=3)
    except (OSError, ValueError) as e:
        logging.warning(f"Metadata lookup failed for {query}: {e}")
        suggestions = []

    best = suggestions[0] if suggestions else None
    if best and best["score"] >= CONFIDENT:
        meta = {
            "artist": best["artist"],
            "title": best["title"],
            "year": best.get("year"),
            "genre": best.get("genre"),
            "album": best.get("album"),
            "artwork": best.get("artwork"),
            "itunes_artist_id": best.get("artist_id"),
            "status": MATCHED,
            "score": best["score"],
        }
    else:
        artist, title = (
            (tags.get("artist", ""), tags.get("title", "")) if tags.get("title") else ("", "")
        )
        if not title:
            artist, title = guess_from_name(query)
        meta = {
            "artist": artist,
            "title": title,
            "year": (tags.get("date") or "")[:4] or None,
            "genre": tags.get("genre"),
            "album": tags.get("album"),
            "status": REVIEW,
            "score": best["score"] if best else None,
        }
    apply(store, song_id, **_with_musicbrainz(meta, get_media_duration(path)))
    return meta["status"]


def _with_musicbrainz(meta: dict, duration: float | None) -> dict:
    """The original year, the artist's MusicBrainz id and a fallback cover, when found."""
    recording = musicbrainz.find_recording(meta["artist"], meta["title"], duration)
    if not recording:
        return meta
    meta = {**meta, "musicbrainz_id": recording["artist_mbid"]}
    if recording["year"]:
        meta["year"] = recording["year"]
    if not meta.get("artwork") and recording["release_mbid"]:
        meta["artwork"] = musicbrainz.cover_url(recording["release_mbid"])
    return meta


def apply(
    store: CatalogStore,
    song_id: int,
    *,
    artist: str,
    title: str,
    year: str | int | None,
    genre: str | None,
    status: str,
    album: str | None = None,
    artwork: str | None = None,
    itunes_artist_id: int | None = None,
    musicbrainz_id: str | None = None,
    score: int | None = None,
) -> None:
    """Write metadata and credits for a song, resolving each artist to its one identity."""
    mains, guests = (
        split_credit(artist, lambda n: store.find_artist(n) is not None) if artist else ([], [])
    )
    single = len(mains) == 1 and is_single_name(mains[0])
    main_ids = [
        store.resolve_artist(
            name, itunes_artist_id if single else None, musicbrainz_id if single else None
        )
        for name in mains
    ]
    if single and musicbrainz_id and not store.has_aliases(main_ids[0]):
        # The first time an artist is met, learn every way their name is spelled.
        store.add_aliases(main_ids[0], musicbrainz.artist_aliases(musicbrainz_id))
    guest_ids = [store.resolve_artist(name) for name in guests]
    year_value = int(str(year)[:4]) if year and str(year)[:4].isdigit() else None
    store.update_song(
        song_id,
        title=title,
        year=year_value,
        genre=genre or None,
        status=status,
        score=score,
        album=album or None,
        cover=_download_cover(song_id, artwork) if artwork else None,
    )
    store.set_song_artists(song_id, main_ids, guest_ids)


def _download_cover(song_id: int, artwork_url: str) -> str | None:
    """A 300 px cover from iTunes, saved once next to the database."""
    os.makedirs(covers_dir(), exist_ok=True)
    name = f"{song_id}.jpg"
    try:
        url = artwork_url.replace("100x100bb", "300x300bb")
        with urllib.request.urlopen(url, timeout=10) as response:
            data = response.read()
    except (urllib.error.URLError, OSError) as e:
        logging.warning(f"Could not download cover for song {song_id}: {e}")
        return None
    with open(os.path.join(covers_dir(), name), "wb") as f:
        f.write(data)
    return name
