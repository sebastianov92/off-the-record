"""Before a download, the catalog says whether the library already has the song."""

from unittest.mock import MagicMock, patch

from pikaraoke.catalog.service import CatalogService


def _service():
    karaoke = MagicMock()
    service = CatalogService.__new__(CatalogService)
    service._karaoke = karaoke
    service.store = MagicMock()
    service.store.find_song.return_value = "/songs/Jeanette - Frente a Frente.m4a"
    return service


@patch("pikaraoke.catalog.service.get_provider")
@patch("pikaraoke.catalog.service.suggest_metadata")
def test_a_confident_match_finds_the_library_copy(suggest, _provider):
    suggest.return_value = [{"artist": "Jeanette", "title": "Frente a Frente", "score": 90}]
    service = _service()

    assert service.find_in_library("Jeanette — Frente a Frente [Letra]") == (
        "/songs/Jeanette - Frente a Frente.m4a"
    )
    service.store.find_song.assert_called_once_with("Jeanette", "Frente a Frente")


@patch("pikaraoke.catalog.service.get_provider")
@patch("pikaraoke.catalog.service.suggest_metadata")
def test_a_doubtful_match_downloads_as_asked(suggest, _provider):
    suggest.return_value = [{"artist": "Someone", "title": "Something", "score": 40}]
    service = _service()

    assert service.find_in_library("some upload title") is None
    service.store.find_song.assert_not_called()


@patch("pikaraoke.catalog.service.get_provider")
@patch("pikaraoke.catalog.service.suggest_metadata", side_effect=OSError("offline"))
def test_no_lookup_means_download_as_asked(_suggest, _provider):
    assert _service().find_in_library("anything") is None
