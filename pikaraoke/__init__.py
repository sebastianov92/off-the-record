import mimetypes

# Before anything serves a file. Slim container images have no /etc/mime.types,
# and Python's own table has no .m4a, so Flask sent the vocal guide and the
# instrumentals as application/octet-stream, which Safari will not play.
mimetypes.add_type("audio/mp4", ".m4a")

from pikaraoke.karaoke import Karaoke  # noqa: E402
from pikaraoke.lib.get_platform import get_platform
from pikaraoke.version import __version__

PACKAGE = __package__
VERSION = __version__

__all__ = [
    "VERSION",
    "PACKAGE",
    Karaoke.__name__,
    get_platform.__name__,
]
