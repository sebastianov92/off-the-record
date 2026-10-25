"""The ai_songs table: one row per song sent to the AI worker.

It lives in the main pikaraoke.db so the server and the worker process share one
source of truth; SQLite's WAL mode lets the worker write while the server reads.
"""

import os
import re
import shutil

from pikaraoke.lib.get_platform import get_data_directory
from pikaraoke.lib.karaoke_database import KaraokeDatabase

QUEUED = "queued"
PROCESSING = "processing"
READY = "ready"
NO_VOCALS = "no_vocals"
ERROR = "error"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ai_songs (
    song_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    -- Code for the step in progress (separating, transcribing...); the UI translates it.
    stage TEXT,
    progress REAL DEFAULT 0,
    error TEXT,
    language TEXT,
    lines INTEGER,
    duration REAL,
    -- Wall-clock seconds the worker spent, to compare machines.
    seconds REAL,
    -- Chosen per song by the player; "style:palette".
    background TEXT,
    lyrics_offset REAL DEFAULT 0,
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    -- When the worker took it, for elapsed time and estimates on the progress page.
    started_at TEXT,
    -- Where the lyrics came from ("lrclib" or "whisper"); NULL asks the worker to look again.
    lyrics_source TEXT,
    -- Share of the published words Whisper heard, when they came from LRCLIB.
    lyrics_match REAL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""

# One row per scored performance; the play it belongs to holds who, what and when.
_SCORES_SCHEMA = """
CREATE TABLE IF NOT EXISTS ai_scores (
    play_id INTEGER PRIMARY KEY,
    song_id INTEGER,
    score INTEGER NOT NULL,
    pitch REAL,
    presence REAL,
    timing REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""

_UPDATABLE = {
    "status",
    "stage",
    "progress",
    "error",
    "language",
    "lines",
    "duration",
    "seconds",
    "background",
    "lyrics_offset",
    "lyrics_source",
    "lyrics_match",
}


def ai_dir(song_id: int) -> str:
    """Kept out of the songs folder: the library scanner would list the stems as songs."""
    return os.path.join(get_data_directory(), "ai", str(song_id))


class AiStore:
    def __init__(self, db: KaraokeDatabase) -> None:
        self._db = db
        self._db.execute(_SCHEMA)
        self._db.execute(_SCORES_SCHEMA)
        columns = {r["name"] for r in self._db.query("PRAGMA table_info(ai_songs)")}
        for column, kind in (
            ("started_at", "TEXT"),
            ("lyrics_source", "TEXT"),
            ("lyrics_match", "REAL"),
        ):
            if column not in columns:
                self._db.execute(f"ALTER TABLE ai_songs ADD COLUMN {column} {kind}")

    def request(self, song_id: int) -> None:
        """Queue a song, or queue it again from scratch."""
        self._db.execute(
            """
            INSERT INTO ai_songs (song_id, status, stage, progress, error)
            VALUES (?, ?, NULL, 0, NULL)
            ON CONFLICT(song_id) DO UPDATE SET
                status = excluded.status, stage = NULL, progress = 0, error = NULL,
                requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            """,
            (song_id, QUEUED),
        )

    def claim_next(self) -> dict | None:
        """Oldest queued song, marked as processing. Only one worker runs, so no race."""
        rows = self._db.query(
            """
            SELECT a.song_id, s.file_path, s.artist, s.title FROM ai_songs a
            JOIN songs s ON s.id = a.song_id
            WHERE a.status = ? ORDER BY a.requested_at, a.song_id LIMIT 1
            """,
            (QUEUED,),
        )
        if not rows:
            return None
        job = dict(rows[0])
        self.update(job["song_id"], status=PROCESSING, progress=0)
        self._db.execute(
            "UPDATE ai_songs SET started_at = CURRENT_TIMESTAMP WHERE song_id = ?",
            (job["song_id"],),
        )
        return job

    def update(self, song_id: int, **fields) -> None:
        unknown = set(fields) - _UPDATABLE
        if unknown:
            raise ValueError(f"Unknown ai_songs columns: {unknown}")
        assignments = ", ".join(f"{name} = ?" for name in fields)
        self._db.execute(
            f"UPDATE ai_songs SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE song_id = ?",
            (*fields.values(), song_id),
        )

    def requeue_interrupted(self) -> None:
        """A song left half-done by a crash or restart starts over."""
        self._db.execute(
            "UPDATE ai_songs SET status = ?, progress = 0 WHERE status = ?", (QUEUED, PROCESSING)
        )

    def song_names(self, song_id: int) -> tuple[str, str]:
        """(artist, title) as the library has them now; from the file name if unknown."""
        rows = self._db.query("SELECT artist, title, file_path FROM songs WHERE id = ?", (song_id,))
        if not rows:
            return "", ""
        row = rows[0]
        if row["title"]:
            return row["artist"] or "", row["title"]
        stem = re.sub(
            r"(---[\w-]{11}| \[[\w-]{11}\])$",
            "",
            os.path.splitext(os.path.basename(row["file_path"]))[0],
        )
        artist, sep, title = stem.partition(" - ")
        return (artist.strip(), title.strip()) if sep else ("", stem.strip())

    def lyrics_to_refresh(self) -> list[dict]:
        rows = self._db.query(
            "SELECT song_id, language FROM ai_songs WHERE status = ? AND lyrics_source IS NULL",
            (READY,),
        )
        return [dict(r) for r in rows]

    def get(self, song_id: int) -> dict | None:
        rows = self._db.query("SELECT * FROM ai_songs WHERE song_id = ?", (song_id,))
        return dict(rows[0]) if rows else None

    def all_states(self) -> list[dict]:
        rows = self._db.query("""
            SELECT a.song_id, s.file_path, s.title, s.artist, a.status, a.stage, a.progress,
                   a.error, a.language, a.lines, a.duration, a.seconds, a.background,
                   a.lyrics_offset, a.lyrics_source, a.lyrics_match, a.requested_at,
                   a.started_at, a.updated_at
            FROM ai_songs a JOIN songs s ON s.id = a.song_id
            """)
        return [dict(r) for r in rows]

    def save_score(self, play_id: int, song_id: int, score: dict) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO ai_scores (play_id, song_id, score, pitch, presence, timing) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (play_id, song_id, score["total"], score["pitch"], score["presence"], score["timing"]),
        )

    def top_scores(self, session_id: int | None, limit: int) -> list[dict]:
        """Best performances, of one session or of all time."""
        where, params = ("WHERE p.session_id = ?", (session_id,)) if session_id else ("", ())
        rows = self._db.query(
            f"""
            SELECT s.score, s.pitch, s.presence, s.timing, p.performer, p.song_title,
                   p.played_at
            FROM ai_scores s JOIN plays p ON p.id = s.play_id {where}
            ORDER BY s.score DESC, p.played_at LIMIT ?
            """,
            (*params, limit),
        )
        return [dict(r) for r in rows]

    def prune_orphans(self) -> int:
        """Forget songs deleted from the library and free their stems."""
        rows = self._db.query(
            "SELECT song_id FROM ai_songs WHERE song_id NOT IN (SELECT id FROM songs)"
        )
        for row in rows:
            self._db.execute("DELETE FROM ai_songs WHERE song_id = ?", (row["song_id"],))
            shutil.rmtree(ai_dir(row["song_id"]), ignore_errors=True)
        return len(rows)
