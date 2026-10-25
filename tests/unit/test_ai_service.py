"""The AI service's hooks into the core that do not need the AI extra."""

from types import SimpleNamespace

from pikaraoke.ai.service import AiService

DEFAULT_VIDEO = "/app/static/video/night_sea.mp4"


def _service(bg_video_path):
    karaoke = SimpleNamespace(
        bg_video_path=bg_video_path, default_bg_video_path=DEFAULT_VIDEO, db=None
    )
    service = AiService.__new__(AiService)
    service._karaoke = karaoke
    return service, karaoke


def test_the_default_sea_video_gives_way_to_the_idle_gradient():
    service, karaoke = _service(DEFAULT_VIDEO)

    service._idle_on_gradient()

    assert karaoke.bg_video_path is None


def test_a_video_the_host_chose_stays():
    service, karaoke = _service("/home/me/videos")

    service._idle_on_gradient()

    assert karaoke.bg_video_path == "/home/me/videos"
