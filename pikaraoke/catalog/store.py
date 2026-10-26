"""Artists, credits and song details, next to PiKaraoke's own songs table.

songs.artist/title/year/genre (unused upstream) hold each song's canonical metadata;
songs.artist is the display credit rebuilt from song_artists whenever an artist
changes, so the rest of PiKaraoke keeps reading one plain string.
"""

import difflib
import os

from pikaraoke.catalog.artists import artist_key, fold, sort_name
from pikaraoke.lib.get_platform import get_data_directory
from pikaraoke.lib.karaoke_database import KaraokeDatabase

# metadata_status values written by this module ("pending" is upstream's default).
MATCHED = "matched"  # confirmed by iTunes with a confident score
REVIEW = "review"  # best guess, an admin should check it
MANUAL = "manual"  # typed or picked by an admin; never overwritten automatically

# Near-identical spellings ("estefan" / "estefen") count as the same artist.
_FUZZY_MATCH = 0.92

_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS artists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sort_name TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        itunes_artist_id INTEGER UNIQUE
    )""",
    # Every other spelling seen for an artist, so it resolves the same way next time.
    "CREATE TABLE IF NOT EXISTS artist_aliases (key TEXT PRIMARY KEY, artist_id INTEGER NOT NULL)",
    """CREATE TABLE IF NOT EXISTS song_artists (
        song_id INTEGER NOT NULL,
        artist_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (song_id, artist_id)
    )""",
    "CREATE TABLE IF NOT EXISTS song_details (song_id INTEGER PRIMARY KEY, album TEXT, cover TEXT)",
]


def covers_dir() -> str:
    return os.path.join(get_data_directory(), "catalog", "covers")


class CatalogStore:
    def __init__(self, db: KaraokeDatabase) -> None:
        self._db = db
        for statement in _SCHEMA:
            self._db.execute(statement)
        columns = {r["name"] for r in self._db.query("PRAGMA table_info(artists)")}
        if "musicbrainz_id" not in columns:
            self._db.execute("ALTER TABLE artists ADD COLUMN musicbrainz_id TEXT")
        # A unique index rather than a column constraint: ALTER TABLE cannot add one.
        self._db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_musicbrainz ON artists(musicbrainz_id)"
        )

    # Artists -----------------------------------------------------------

    def find_artist(self, name: str) -> int | None:
        key = artist_key(name)
        if not key:
            return None
        rows = self._db.query(
            "SELECT id FROM artists WHERE key = ? UNION "
            "SELECT artist_id FROM artist_aliases WHERE key = ?",
            (key, key),
        )
        return rows[0][0] if rows else None

    def resolve_artist(
        self, name: str, itunes_artist_id: int | None = None, musicbrainz_id: str | None = None
    ) -> int:
        """The one artist a name means: by MusicBrainz or iTunes id, known spelling, near
        spelling, or new."""
        name = name.strip()
        key = artist_key(name)
        if musicbrainz_id:
            rows = self._db.query(
                "SELECT id FROM artists WHERE musicbrainz_id = ?", (musicbrainz_id,)
            )
            if rows:
                self._add_alias(key, rows[0][0])
                return rows[0][0]
        if itunes_artist_id:
            rows = self._db.query(
                "SELECT id FROM artists WHERE itunes_artist_id = ?", (itunes_artist_id,)
            )
            if rows:
                self._add_alias(key, rows[0][0])
                self._claim_musicbrainz(rows[0][0], musicbrainz_id)
                return rows[0][0]
        artist_id = self.find_artist(name) or self._fuzzy_artist(key)
        if artist_id is None:
            cur = self._db.execute(
                "INSERT INTO artists (name, sort_name, key, itunes_artist_id, musicbrainz_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (name, sort_name(name), key, itunes_artist_id, musicbrainz_id),
            )
            return cur.lastrowid
        self._add_alias(key, artist_id)
        self._claim_musicbrainz(artist_id, musicbrainz_id)
        if itunes_artist_id:
            # iTunes spells the name the way the artist does; adopt it.
            row = self._db.query("SELECT key FROM artists WHERE id = ?", (artist_id,))[0]
            self._add_alias(row[0], artist_id)
            self._db.execute(
                "UPDATE artists SET itunes_artist_id = ?, name = ?, sort_name = ? "
                "WHERE id = ? AND itunes_artist_id IS NULL",
                (itunes_artist_id, name, sort_name(name), artist_id),
            )
        return artist_id

    def _claim_musicbrainz(self, artist_id: int, musicbrainz_id: str | None) -> None:
        if musicbrainz_id:
            self._db.execute(
                "UPDATE OR IGNORE artists SET musicbrainz_id = ? "
                "WHERE id = ? AND musicbrainz_id IS NULL",
                (musicbrainz_id, artist_id),
            )

    def has_aliases(self, artist_id: int) -> bool:
        """Whether spellings beyond the artist's own key are known yet."""
        rows = self._db.query(
            "SELECT COUNT(*) FROM artist_aliases WHERE artist_id = ?", (artist_id,)
        )
        return rows[0][0] > 1

    def add_aliases(self, artist_id: int, names: list[str]) -> None:
        """Teach the library other spellings of an artist; a spelling already taken
        by another artist stays theirs."""
        for name in names:
            key = artist_key(name)
            if key:
                self._db.execute(
                    "INSERT OR IGNORE INTO artist_aliases (key, artist_id) VALUES (?, ?)",
                    (key, artist_id),
                )

    def _fuzzy_artist(self, key: str) -> int | None:
        best, best_ratio = None, _FUZZY_MATCH
        for row in self._db.query("SELECT id, key FROM artists"):
            ratio = difflib.SequenceMatcher(None, key, row["key"]).ratio()
            if ratio >= best_ratio:
                best, best_ratio = row["id"], ratio
        return best

    def _add_alias(self, key: str, artist_id: int) -> None:
        if key:
            self._db.execute(
                "INSERT OR REPLACE INTO artist_aliases (key, artist_id) VALUES (?, ?)",
                (key, artist_id),
            )

    def set_song_artists(self, song_id: int, mains: list[int], guests: list[int]) -> None:
        self._db.execute("DELETE FROM song_artists WHERE song_id = ?", (song_id,))
        credits = [(a, "main") for a in mains] + [(a, "guest") for a in guests if a not in mains]
        for position, (artist_id, role) in enumerate(credits):
            self._db.execute(
                "INSERT OR IGNORE INTO song_artists (song_id, artist_id, role, position) "
                "VALUES (?, ?, ?, ?)",
                (song_id, artist_id, role, position),
            )
        self._refresh_credit(song_id)

    def _refresh_credit(self, song_id: int) -> None:
        rows = self._db.query(
            "SELECT a.name, sa.role FROM song_artists sa JOIN artists a ON a.id = sa.artist_id "
            "WHERE sa.song_id = ? ORDER BY sa.position",
            (song_id,),
        )
        mains = [r["name"] for r in rows if r["role"] == "main"]
        guests = [r["name"] for r in rows if r["role"] == "guest"]
        credit = " & ".join(mains) + (f" feat. {', '.join(guests)}" if guests else "")
        self._db.execute("UPDATE songs SET artist = ? WHERE id = ?", (credit or None, song_id))

    def _refresh_artist_songs(self, artist_id: int) -> None:
        for row in self._db.query(
            "SELECT song_id FROM song_artists WHERE artist_id = ?", (artist_id,)
        ):
            self._refresh_credit(row["song_id"])

    def merge_artists(self, source_id: int, target_id: int) -> None:
        """Fold one artist into another: its songs, spellings and iTunes id move over."""
        if source_id == target_id:
            return
        source = self._db.query("SELECT * FROM artists WHERE id = ?", (source_id,))
        if not source:
            return
        source = source[0]
        songs = [
            r["song_id"]
            for r in self._db.query(
                "SELECT song_id FROM song_artists WHERE artist_id = ?", (source_id,)
            )
        ]
        self._db.execute(
            "UPDATE OR IGNORE song_artists SET artist_id = ? WHERE artist_id = ?",
            (target_id, source_id),
        )
        self._db.execute("DELETE FROM song_artists WHERE artist_id = ?", (source_id,))
        self._db.execute(
            "UPDATE artist_aliases SET artist_id = ? WHERE artist_id = ?", (target_id, source_id)
        )
        self._db.execute("DELETE FROM artists WHERE id = ?", (source_id,))
        self._add_alias(source["key"], target_id)
        self._claim_musicbrainz(target_id, source["musicbrainz_id"])
        if source["itunes_artist_id"]:
            self._db.execute(
                "UPDATE artists SET itunes_artist_id = ? WHERE id = ? AND itunes_artist_id IS NULL",
                (source["itunes_artist_id"], target_id),
            )
        for song_id in songs:
            self._refresh_credit(song_id)

    def rename_artist(self, artist_id: int, name: str) -> int:
        """Rename; if the new name is another artist's, the two become one. Returns the survivor."""
        other = self.find_artist(name)
        if other is not None and other != artist_id:
            self.merge_artists(artist_id, other)
            return other
        old = self._db.query("SELECT key FROM artists WHERE id = ?", (artist_id,))[0]
        self._add_alias(old["key"], artist_id)
        self._db.execute(
            "UPDATE artists SET name = ?, sort_name = ?, key = ? WHERE id = ?",
            (name.strip(), sort_name(name), artist_key(name), artist_id),
        )
        self._refresh_artist_songs(artist_id)
        return artist_id

    # Songs ---------------------------------------------------------------

    def update_song(
        self,
        song_id: int,
        *,
        title: str,
        year: int | None,
        genre: str | None,
        status: str,
        score: int | None = None,
        album: str | None = None,
        cover: str | None = None,
    ) -> None:
        self._db.execute(
            "UPDATE songs SET title = ?, year = ?, genre = ?, metadata_status = ?, "
            "suggested_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (title, year, genre, status, score, song_id),
        )
        self._db.execute(
            "INSERT INTO song_details (song_id, album, cover) VALUES (?, ?, ?) "
            "ON CONFLICT(song_id) DO UPDATE SET album = excluded.album, "
            "cover = COALESCE(excluded.cover, song_details.cover)",
            (song_id, album, cover),
        )

    def song(self, song_id: int) -> dict | None:
        rows = self._db.query("SELECT * FROM songs WHERE id = ?", (song_id,))
        return dict(rows[0]) if rows else None

    def find_song(self, artist: str, title: str) -> str | None:
        """The file of a song with this title by this artist, spelling and case aside."""
        want_artist, want_title = artist_key(artist), fold(title).strip()
        for r in self._db.query(
            "SELECT s.file_path, s.title, ar.name FROM songs s "
            "JOIN song_artists sa ON sa.song_id = s.id JOIN artists ar ON ar.id = sa.artist_id "
            "WHERE s.title IS NOT NULL"
        ):
            if fold(r["title"]).strip() == want_title and artist_key(r["name"]) == want_artist:
                return r["file_path"]
        return None

    def songs_to_organize(self) -> list[dict]:
        rows = self._db.query(
            "SELECT id, file_path FROM songs WHERE metadata_status IS NULL "
            "OR metadata_status NOT IN (?, ?)",
            (MATCHED, MANUAL),
        )
        return [dict(r) for r in rows]

    def library(self) -> list[dict]:
        """Every song with its credits, details and AI state, for the library page."""
        rows = self._db.query("""
            SELECT s.id, s.file_path, s.title, s.year, s.genre, s.metadata_status, s.created_at,
                   d.album, d.cover, a.status AS ai_status, a.progress AS ai_progress,
                   a.language, a.lyrics_source
            FROM songs s
            LEFT JOIN song_details d ON d.song_id = s.id
            LEFT JOIN ai_songs a ON a.song_id = s.id
            """)
        credits: dict[int, list[dict]] = {}
        for r in self._db.query(
            "SELECT sa.song_id, sa.role, ar.id, ar.name FROM song_artists sa "
            "JOIN artists ar ON ar.id = sa.artist_id ORDER BY sa.song_id, sa.position"
        ):
            credits.setdefault(r["song_id"], []).append(
                {"id": r["id"], "name": r["name"], "role": r["role"]}
            )
        songs = []
        for r in rows:
            song = dict(r)
            song["artists"] = credits.get(song["id"], [])
            song["search_key"] = fold(
                " ".join(
                    [song["title"] or "", os.path.basename(song["file_path"])]
                    + [a["name"] for a in song["artists"]]
                )
            )
            songs.append(song)
        return songs

    def artists(self) -> list[dict]:
        rows = self._db.query("""
            SELECT ar.id, ar.name, ar.sort_name, COUNT(sa.song_id) AS songs
            FROM artists ar LEFT JOIN song_artists sa ON sa.artist_id = ar.id
            GROUP BY ar.id ORDER BY ar.sort_name
            """)
        return [dict(r) for r in rows]

    def prune_artists(self) -> None:
        """Drop credits of deleted songs and artists left with no songs."""
        self._db.execute("DELETE FROM song_artists WHERE song_id NOT IN (SELECT id FROM songs)")
        self._db.execute("DELETE FROM song_details WHERE song_id NOT IN (SELECT id FROM songs)")
        self._db.execute(
            "DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)"
        )
        self._db.execute(
            "DELETE FROM artist_aliases WHERE artist_id NOT IN (SELECT id FROM artists)"
        )
