"""Tests for the organised library: artist identity, credits, merging and renaming."""

import pytest

from pikaraoke.catalog.artists import artist_key, split_credit
from pikaraoke.catalog.store import MANUAL, CatalogStore
from pikaraoke.lib.karaoke_database import KaraokeDatabase


@pytest.fixture
def store(tmp_path):
    db = KaraokeDatabase(str(tmp_path / "test.db"))
    db.insert_songs(
        [
            {"file_path": f"/songs/song{i}.m4a", "youtube_id": None, "format": "m4a"}
            for i in range(1, 4)
        ]
    )
    return CatalogStore(db)


def song_ids(store):
    return [row["id"] for row in store._db.query("SELECT id FROM songs ORDER BY id")]


class TestArtistKey:
    def test_case_accents_and_punctuation_do_not_matter(self):
        assert artist_key("Gloria Estefán") == artist_key("GLORIA ESTEFAN") == "gloria estefan"
        assert artist_key("Gloria Estefan.") == "gloria estefan"

    def test_ampersand_and_leading_the(self):
        assert artist_key("The Beatles") == artist_key("Beatles")
        assert artist_key("Simon & Garfunkel") == artist_key("simon and garfunkel")


class TestSplitCredit:
    def test_guests_after_feat(self):
        assert split_credit("Main Artist feat. Guest One & Guest Two", lambda _n: False) == (
            ["Main Artist"],
            ["Guest One", "Guest Two"],
        )

    def test_unknown_duo_stays_one_artist(self):
        assert split_credit("Simon & Garfunkel", lambda _n: False) == (["Simon & Garfunkel"], [])

    def test_joint_credit_splits_when_a_part_is_known(self):
        mains, guests = split_credit("Shakira & Bizarrap", lambda n: n == "Shakira")
        assert mains == ["Shakira", "Bizarrap"]
        assert guests == []


class TestResolveArtist:
    def test_spellings_resolve_to_one_artist(self, store):
        first = store.resolve_artist("Gloria Estefan")
        assert store.resolve_artist("GLORIA ESTEFAN") == first
        assert store.resolve_artist("Gloria Estefán") == first
        assert store.resolve_artist("Gloria Estefen") == first  # near spelling

    def test_itunes_id_wins_and_fixes_the_name(self, store):
        typed = store.resolve_artist("gloria estefan")
        canonical = store.resolve_artist("Gloria Estefan", itunes_artist_id=123)
        assert canonical == typed
        assert store.artists()[0]["name"] == "Gloria Estefan"

    def test_different_artists_stay_apart(self, store):
        assert store.resolve_artist("Luis Miguel") != store.resolve_artist("Luis Fonsi")


class TestCreditsMergeRename:
    def test_credit_string_rebuilt_from_artists(self, store):
        song = song_ids(store)[0]
        main, guest = store.resolve_artist("Main"), store.resolve_artist("Guest")
        store.set_song_artists(song, [main], [guest])
        assert store.song(song)["artist"] == "Main feat. Guest"

    def test_merge_moves_songs_and_keeps_spelling_as_alias(self, store):
        a, b = song_ids(store)[:2]
        wrong = store.resolve_artist("Glorya Estfan")
        right = store.resolve_artist("Gloria Estefan")
        store.set_song_artists(a, [wrong], [])
        store.set_song_artists(b, [right], [])

        store.merge_artists(wrong, right)

        assert [x["id"] for x in store.artists()] == [right]
        assert store.song(a)["artist"] == "Gloria Estefan"
        assert store.resolve_artist("Glorya Estfan") == right

    def test_renaming_to_an_existing_name_merges(self, store):
        a, b = song_ids(store)[:2]
        one, other = store.resolve_artist("Artist One"), store.resolve_artist("Artist Two")
        store.set_song_artists(a, [one], [])
        store.set_song_artists(b, [other], [])

        survivor = store.rename_artist(one, "Artist Two")

        assert survivor == other
        assert store.song(a)["artist"] == "Artist Two"

    def test_manual_songs_are_not_reorganised(self, store):
        song = song_ids(store)[0]
        store.update_song(song, title="Kept", year=None, genre=None, status=MANUAL)
        assert song not in [s["id"] for s in store.songs_to_organize()]


class TestMusicBrainzIdentity:
    def test_musicbrainz_id_beats_spelling(self, store):
        band = store.resolve_artist("Juan Luis Guerra 4.40", musicbrainz_id="mb-1")
        assert store.resolve_artist("JLG y su banda", musicbrainz_id="mb-1") == band

    def test_aliases_send_variants_to_the_same_artist(self, store):
        band = store.resolve_artist("Juan Luis Guerra 4.40", musicbrainz_id="mb-1")
        store.add_aliases(band, ["Juan Luis Guerra y 440", "Juan Luis Guerra & 440"])
        assert store.resolve_artist("JUAN LUIS GUERRA Y 440") == band
        assert store.has_aliases(band)

    def test_merge_hands_over_the_musicbrainz_id(self, store):
        typed = store.resolve_artist("Glorya Estfan")
        known = store.resolve_artist("Gloria Estefan", musicbrainz_id="mb-2")
        store.merge_artists(known, typed)
        assert store.resolve_artist("Anything", musicbrainz_id="mb-2") == typed
